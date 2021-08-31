// SPDX-License-Identifier: MIT
pragma solidity 0.6.11;


import './Interfaces/IUniswapV2Pair.sol';
import './UniswapV2ERC20.sol';
import '../Math/Math.sol';
import '../Math/UQ112x112.sol';
import '../ERC20/IERC20.sol';
import '../Math/FixedPoint.sol';
import './Interfaces/IUniswapV2Factory.sol';
import './Interfaces/IUniswapV2Callee.sol';
import './Interfaces/IUniswapV2Factory.sol';
import '../Oracle/ICryptoPairOracle.sol';
import './UniswapV2OracleLibrary.sol';

import "hardhat/console.sol";

contract UniswapV2Pair is IUniswapV2Pair, ICryptoPairOracle {
    using FixedPoint for *;
    using SafeMath  for uint;
    using UQ112x112 for uint224;

    string public override constant name = 'Blindex Swap';
    string public override constant symbol = 'BDSWAP';
    uint8 public override constant decimals = 18;
    uint  public override totalSupply;
    mapping(address => uint) public override balanceOf;
    mapping(address => mapping(address => uint)) public override allowance;

    uint public override constant MINIMUM_LIQUIDITY = 10**3;
    bytes4 private constant SELECTOR = bytes4(keccak256(bytes('transfer(address,uint256)')));
    bytes32 public override DOMAIN_SEPARATOR;
    // keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
    bytes32 public constant override PERMIT_TYPEHASH = 0x6e71edae12b1b97f4d1f60370fef10105fa2faae0126114a169c64845d6126c9;
    mapping(address => uint) public override nonces;

    address public override factory;
    address public override token0;
    address public override token1;

    uint112 internal reserve0;           // uses single storage slot, accessible via getReserves
    uint112 internal reserve1;           // uses single storage slot, accessible via getReserves
    uint32  internal blockTimestampLast; // uses single storage slot, accessible via getReserves

    uint public override price0CumulativeLast;
    uint public override price1CumulativeLast;
    uint public override kLast; // reserve0 * reserve1, as of immediately after the most recent liquidity event


    uint public PERIOD = 3600; // 1 hour TWAP (time-weighted average price)
    uint public CONSULT_LENIENCY = 120; // Used for being able to consult past the period end
    bool public ALLOW_STALE_CONSULTS = false; // If false, consult() will fail if the TWAP is stale
    FixedPoint.uq112x112 public price0AverageOracle;
    FixedPoint.uq112x112 public price1AverageOracle;
    uint    public price0CumulativeLastOracle;
    uint    public price1CumulativeLastOracle;
    uint32  public blockTimestampLastOracle;

    mapping(address => uint256) public lastSwapByUserOut0;
    mapping(address => uint256) public lastSwapByUserOut1;

    uint256 minimumSwapsDelayInBlocks = 0;

    address public owner_address;
    address public timelock_address;
    address public treasury_address;

    uint private unlocked = 1;
    modifier lock() {
        require(unlocked == 1, 'UniswapV2: LOCKED');
        unlocked = 0;
        _;
        unlocked = 1;
    }

    function getReserves() public override view returns (uint112 _reserve0, uint112 _reserve1, uint32 _blockTimestampLast) {
        _reserve0 = reserve0;
        _reserve1 = reserve1;
        _blockTimestampLast = blockTimestampLast;
    }

    function _safeTransfer(address token, address to, uint value) private {
        (bool success, bytes memory data) = token.call(abi.encodeWithSelector(SELECTOR, to, value));
        require(success && (data.length == 0 || abi.decode(data, (bool))), 'UniswapV2: TRANSFER_FAILED');
    }

    event Mint(address indexed sender, uint amount0, uint amount1);
    event Burn(address indexed sender, uint amount0, uint amount1, address indexed to);
    event Swap(
        address indexed sender,
        uint amount0In,
        uint amount1In,
        uint amount0Out,
        uint amount1Out,
        address indexed to
    );
    event Sync(uint112 reserve0, uint112 reserve1);

    constructor(address _owner_address, address _treasury_address) public {
        factory = msg.sender;

        owner_address = _owner_address;
        treasury_address = _treasury_address;
    }

    // called once by the factory at time of deployment
    function initialize(address _token0, address _token1) external override {
        require(msg.sender == factory, 'UniswapV2: FORBIDDEN'); // sufficient check
        token0 = _token0;
        token1 = _token1;
    }

    // update reserves and, on the first call per block, price accumulators
    function _update(uint balance0, uint balance1, uint112 _reserve0, uint112 _reserve1) virtual internal {
        require(balance0 <= uint112(-1) && balance1 <= uint112(-1), 'UniswapV2: OVERFLOW');
        uint32 blockTimestamp = uint32(block.timestamp % 2**32);
        uint32 timeElapsed = blockTimestamp - blockTimestampLast; // overflow is desired
        if (timeElapsed > 0 && _reserve0 != 0 && _reserve1 != 0) {
            // * never overflows, and + overflow is desired
            price0CumulativeLast += uint(UQ112x112.encode(_reserve1).uqdiv(_reserve0)) * timeElapsed;
            price1CumulativeLast += uint(UQ112x112.encode(_reserve0).uqdiv(_reserve1)) * timeElapsed;
        }
        reserve0 = uint112(balance0);
        reserve1 = uint112(balance1);
        blockTimestampLast = blockTimestamp;

        updateOracle();

        emit Sync(reserve0, reserve1);
    }

    // if fee is on, mint liquidity equivalent to 1/6th of the growth in sqrt(k)
    function _mintFee(uint112 _reserve0, uint112 _reserve1) private returns (bool feeOn) {
        address feeTo = IUniswapV2Factory(factory).feeTo();
        feeOn = feeTo != address(0);
        uint _kLast = kLast; // gas savings
        if (feeOn) {
            if (_kLast != 0) {
                uint rootK = Math.sqrt(uint(_reserve0).mul(_reserve1));
                uint rootKLast = Math.sqrt(_kLast);
                if (rootK > rootKLast) {
                    uint numerator = totalSupply.mul(rootK.sub(rootKLast));
                    uint denominator = rootK.mul(5).add(rootKLast);
                    uint liquidity = numerator / denominator;
                    if (liquidity > 0) _mint(feeTo, liquidity);
                }
            }
        } else if (_kLast != 0) {
            kLast = 0;
        }
    }

    // this low-level function should be called from a contract which performs important safety checks
    function mint(address to) external override lock returns (uint liquidity) {
        (uint112 _reserve0, uint112 _reserve1,) = getReserves(); // gas savings
        uint balance0 = IERC20(token0).balanceOf(address(this));
        uint balance1 = IERC20(token1).balanceOf(address(this));

        uint amount0 = balance0.sub(_reserve0);
        uint amount1 = balance1.sub(_reserve1);
        bool feeOn = _mintFee(_reserve0, _reserve1);
        uint _totalSupply = totalSupply; // gas savings, must be defined here since totalSupply can update in _mintFee

        if (_totalSupply == 0) {
            liquidity = Math.sqrt(amount0.mul(amount1)).sub(MINIMUM_LIQUIDITY);
           _mint(address(0), MINIMUM_LIQUIDITY); // permanently lock the first MINIMUM_LIQUIDITY tokens
        } else {
            liquidity = Math.min(amount0.mul(_totalSupply) / _reserve0, amount1.mul(_totalSupply) / _reserve1);
        }

        require(liquidity > 0, 'UniswapV2: INSUFFICIENT_LIQUIDITY_MINTED');
        _mint(to, liquidity);

        _update(balance0, balance1, _reserve0, _reserve1);

        if (feeOn) kLast = uint(reserve0).mul(reserve1); // reserve0 and reserve1 are up-to-date
        emit Mint(msg.sender, amount0, amount1);
    }

    // this low-level function should be called from a contract which performs important safety checks
    function burn(address to) external override lock returns (uint amount0, uint amount1) {
        (uint112 _reserve0, uint112 _reserve1,) = getReserves(); // gas savings
        address _token0 = token0;                                // gas savings
        address _token1 = token1;                                // gas savings
        uint balance0 = IERC20(_token0).balanceOf(address(this));
        uint balance1 = IERC20(_token1).balanceOf(address(this));
        uint liquidity = balanceOf[address(this)];

        bool feeOn = _mintFee(_reserve0, _reserve1);
        uint _totalSupply = totalSupply; // gas savings, must be defined here since totalSupply can update in _mintFee
        amount0 = liquidity.mul(balance0) / _totalSupply; // using balances ensures pro-rata distribution
        amount1 = liquidity.mul(balance1) / _totalSupply; // using balances ensures pro-rata distribution
        require(amount0 > 0 && amount1 > 0, 'UniswapV2: INSUFFICIENT_LIQUIDITY_BURNED');
        _burn(address(this), liquidity);
        _safeTransfer(_token0, to, amount0);
        _safeTransfer(_token1, to, amount1);
        balance0 = IERC20(_token0).balanceOf(address(this));
        balance1 = IERC20(_token1).balanceOf(address(this));

        _update(balance0, balance1, _reserve0, _reserve1);
        if (feeOn) kLast = uint(reserve0).mul(reserve1); // reserve0 and reserve1 are up-to-date
        emit Burn(msg.sender, amount0, amount1, to);
    }

    // this low-level function should be called from a contract which performs important safety checks
    function swap(uint amount0Out, uint amount1Out, address to, bytes calldata data) external override lock {
        require(amount0Out > 0 || amount1Out > 0, 'UniswapV2: INSUFFICIENT_OUTPUT_AMOUNT');
        (uint112 _reserve0, uint112 _reserve1,) = getReserves(); // gas savings
        require(amount0Out < _reserve0 && amount1Out < _reserve1, 'UniswapV2: INSUFFICIENT_LIQUIDITY');

        uint balance0;
        uint balance1;

        {
            require(to != token0 && to != token1, 'UniswapV2: INVALID_TO');

            if (amount0Out > 0) {
                if(block.number.sub(lastSwapByUserOut1[to]) < minimumSwapsDelayInBlocks) {
                    _safeTransfer(token0, to, amount0Out.div(10)); // optimistically transfer tokens
                    _safeTransfer(token0, treasury_address, amount0Out.mul(9).div(10)); // optimistically transfer tokens
                } else {
                    _safeTransfer(token0, to, amount0Out); // optimistically transfer tokens
                }

                lastSwapByUserOut0[to] = block.number;
            }

            if (amount1Out > 0) {
                if(block.number.sub(lastSwapByUserOut0[to]) < minimumSwapsDelayInBlocks){
                    _safeTransfer(token1, to, amount1Out.div(10)); // optimistically transfer tokens
                    _safeTransfer(token1, treasury_address, amount1Out.mul(9).div(10)); // optimistically transfer tokens
                } else {
                    _safeTransfer(token1, to, amount1Out); // optimistically transfer tokens
                }

                lastSwapByUserOut1[to] = block.number;
            }

            if (data.length > 0) IUniswapV2Callee(to).uniswapV2Call(msg.sender, amount0Out, amount1Out, data);
            balance0 = IERC20(token0).balanceOf(address(this));
            balance1 = IERC20(token1).balanceOf(address(this));
        }
        
        uint amount0In = balance0 > _reserve0 - amount0Out ? balance0 - (_reserve0 - amount0Out) : 0;
        uint amount1In = balance1 > _reserve1 - amount1Out ? balance1 - (_reserve1 - amount1Out) : 0;
        require(amount0In > 0 || amount1In > 0, 'UniswapV2: INSUFFICIENT_INPUT_AMOUNT');

        { // scope for reserve{0,1}Adjusted, avoids stack too deep errors
            uint balance0Adjusted = balance0.mul(1000).sub(amount0In.mul(3));
            uint balance1Adjusted = balance1.mul(1000).sub(amount1In.mul(3));
            require(balance0Adjusted.mul(balance1Adjusted) >= uint(_reserve0).mul(_reserve1).mul(1000**2), 'UniswapV2: K');
        }

        _update(balance0, balance1, _reserve0, _reserve1);
        emit Swap(msg.sender, amount0In, amount1In, amount0Out, amount1Out, to);
    }

    // force balances to match reserves
    function skim(address to) external override lock {
        address _token0 = token0; // gas savings
        address _token1 = token1; // gas savings
        _safeTransfer(_token0, to, IERC20(_token0).balanceOf(address(this)).sub(reserve0));
        _safeTransfer(_token1, to, IERC20(_token1).balanceOf(address(this)).sub(reserve1));
    }

    // force reserves to match balances
    function sync() external override lock {
        _update(IERC20(token0).balanceOf(address(this)), IERC20(token1).balanceOf(address(this)), reserve0, reserve1);
    }



    // Migrated over from UniswapV2ERC20. Needed for ^0.6.11
    // ===============================================

    function _mint(address to, uint value) internal {
        totalSupply = totalSupply.add(value);
        balanceOf[to] = balanceOf[to].add(value);
        emit Transfer(address(0), to, value);
    }

    function _burn(address from, uint value) internal {
        balanceOf[from] = balanceOf[from].sub(value);
        totalSupply = totalSupply.sub(value);
        emit Transfer(from, address(0), value);
    }

    function _approve(address owner, address spender, uint value) private {
        allowance[owner][spender] = value;
        emit Approval(owner, spender, value);
    }

    function _transfer(address from, address to, uint value) private {
        balanceOf[from] = balanceOf[from].sub(value);
        balanceOf[to] = balanceOf[to].add(value);
        emit Transfer(from, to, value);
    }

    function approve(address spender, uint value) external override returns (bool) {
        _approve(msg.sender, spender, value);
        return true;
    }

    function transfer(address to, uint value) external override returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint value) external override returns (bool) {
        if (allowance[from][msg.sender] != uint(-1)) {
            allowance[from][msg.sender] = allowance[from][msg.sender].sub(value);
        }
        _transfer(from, to, value);
        return true;
    }

    function permit(address owner, address spender, uint value, uint deadline, uint8 v, bytes32 r, bytes32 s) external override {
        require(deadline >= block.timestamp, 'UniswapV2: EXPIRED');
        bytes32 digest = keccak256(
            abi.encodePacked(
                '\x19\x01',
                DOMAIN_SEPARATOR,
                keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, value, nonces[owner]++, deadline))
            )
        );
        address recoveredAddress = ecrecover(digest, v, r, s);
        require(recoveredAddress != address(0) && recoveredAddress == owner, 'UniswapV2: INVALID_SIGNATURE');
        _approve(owner, spender, value);
    }

    function setOwner_address(address _owner_address) external onlyByOwnerOrGovernance {
        owner_address = _owner_address;
    }

    function setTimelock_address(address _timelock_address) external onlyByOwnerOrGovernance {
        timelock_address = _timelock_address;
    }

    function setTreasury_address(address _treasury_address) external onlyByOwnerOrGovernance {
        treasury_address = _treasury_address;
    }

    function setMinimumSwapsDelayInBlocks(uint256 _minimumSwapsDelayInBlocks) external onlyByOwnerOrGovernance{
        minimumSwapsDelayInBlocks = _minimumSwapsDelayInBlocks;
    }

    function setPeriod(uint _period) external onlyByOwnerOrGovernance {
        PERIOD = _period;
    }

    function setConsultLeniency(uint _consult_leniency) external onlyByOwnerOrGovernance {
        CONSULT_LENIENCY = _consult_leniency;
    }

    function setAllowStaleConsults(bool _allow_stale_consults) external onlyByOwnerOrGovernance {
        ALLOW_STALE_CONSULTS = _allow_stale_consults;
    }

    function updateOracle() public override {
        uint32 blockTimestamp = UniswapV2OracleLibrary.currentBlockTimestamp();
        uint32 timeElapsed = blockTimestamp - blockTimestampLastOracle; // Overflow is desired

        if(timeElapsed >= PERIOD || msg.sender == owner_address) {
            uint price0Cumulative = price0CumulativeLast;
            uint price1Cumulative = price1CumulativeLast;

            if (blockTimestampLast != blockTimestamp) {
                // This if (coppied form original UniswapV2OracleLibrary) handles the case
                // when oracle update is called some time after swap update this compensates 
                // for the elapsed time.
                // Execution only enters this if when update oracle is called manually
                // when called as a part of minting, redeeming, swapping, etc., this if is skipped.
                // Which is fine since in the cases above happen in the same blocka as oracle
                // update, so there is nothing to compensate for.

                // subtraction overflow is desired
                uint32 timeElapsed = blockTimestamp - blockTimestampLast;
                // addition overflow is desired
                // counterfactual
                price0Cumulative += uint(FixedPoint.fraction(reserve1, reserve0)._x) * timeElapsed;
                // counterfactual
                price1Cumulative += uint(FixedPoint.fraction(reserve0, reserve1)._x) * timeElapsed;
            }

            price0AverageOracle = FixedPoint.uq112x112(uint224((price0Cumulative - price0CumulativeLastOracle) / timeElapsed));
            price1AverageOracle = FixedPoint.uq112x112(uint224((price1Cumulative - price1CumulativeLastOracle) / timeElapsed));

            price0CumulativeLastOracle = price0Cumulative;
            price1CumulativeLastOracle = price1Cumulative;
            blockTimestampLastOracle = blockTimestamp;
        }
    }

    function shouldUpdateOracle() public view override returns (bool){
        uint256 margin = 60; // one minute
        uint256 blockTimestamp = UniswapV2OracleLibrary.currentBlockTimestamp();
        uint256 timeElapsed = blockTimestamp - blockTimestampLastOracle; // Overflow is desired

        if((timeElapsed < (PERIOD + CONSULT_LENIENCY - margin)) || ALLOW_STALE_CONSULTS){
            return false;
        } else {
            return true;
        }
    }

    // Note this will always return 0 before update has been called successfully for the first time.
    function consult(address token, uint256 amountIn) external view override returns (uint256 amountOut) {
        uint256 blockTimestamp = UniswapV2OracleLibrary.currentBlockTimestamp();
        uint256 timeElapsed = blockTimestamp - blockTimestampLastOracle; // Overflow is desired

        // Ensure that the price is not stale
        require((timeElapsed < (PERIOD + CONSULT_LENIENCY)) || ALLOW_STALE_CONSULTS,
                'UniswapPairOracle: PRICE_IS_STALE_NEED_TO_CALL_UPDATE');

        if (token == token0) {
            amountOut = price0AverageOracle.mul(amountIn).decode144();
        } else {
            require(token == token1, 'UniswapPairOracle: INVALID_TOKEN');
            amountOut = price1AverageOracle.mul(amountIn).decode144();
        }
    }

    modifier onlyByOwnerOrGovernance() {
        require(msg.sender == owner_address || msg.sender == timelock_address, "You are not an owner or the governance timelock");
        _;
    }

}