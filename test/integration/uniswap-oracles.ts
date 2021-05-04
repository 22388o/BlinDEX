import hre from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import cap from "chai-as-promised";

import { bigNumberToDecmal } from "../../utils/Helpers";
import { UniswapPairOracle } from "../../typechain/UniswapPairOracle";

import { deployUniswapOracle } from "../../deploy_manual/manual_deploy_uniswap_price_feeds"
import { BDXShares } from "../../typechain/BDXShares";
import { BDStable } from "../../typechain/BDStable";
import * as constants from '../../utils/Constatnts'
import { provideLiquidity_WETH_BDEUR, provideLiquidity_BDX_WETH} from "../helpers/liquidity-providing"
import { simulateTimeElapseInDays, simulateTimeElapseInSeconds, toErc20 } from "../../utils/Helpers"
import { UniswapV2Router02 } from "../../typechain/UniswapV2Router02";
import { WETH } from "../../typechain/WETH";
import { UniswapV2Factory } from "../../typechain/UniswapV2Factory";
import { UniswapV2Pair } from "../../typechain/UniswapV2Pair";

chai.use(cap);

chai.use(solidity);
const { expect } = chai;

async function swapWethFor(bdStableName: string, wEthToSwap: number) {
    const bdStable = await hre.ethers.getContract(bdStableName) as unknown as BDStable;

    const testUser = await hre.ethers.getNamedSigner('TEST2');

    const uniswapV2Router02 = await hre.ethers.getContract('UniswapV2Router02', testUser) as unknown as UniswapV2Router02;

    const currentBlock = await hre.ethers.provider.getBlock("latest");

    const weth = await hre.ethers.getContractAt("WETH", constants.wETH_address, testUser.address) as unknown as WETH;
    await weth.deposit({ value: toErc20(100) });

    await weth.approve(uniswapV2Router02.address, toErc20(wEthToSwap));
    await uniswapV2Router02.swapExactTokensForTokens(
        toErc20(wEthToSwap),
        1,
        [constants.wETH_address, bdStable.address],
        testUser.address,
        currentBlock.timestamp + 24*60*60*7);

    console.log("Swapped WETH for " + bdStableName);
}

async function getPrices(bdStableName: string) {
    const bdStable = await hre.ethers.getContract(bdStableName) as unknown as BDStable;

    const testUser = await hre.ethers.getNamedSigner('TEST2');

    const uniswapV2Router02 = await hre.ethers.getContract('UniswapV2Router02', testUser) as unknown as UniswapV2Router02;

    const wethInBdStablePrice = await uniswapV2Router02.consult(constants.wETH_address, toErc20(1), bdStable.address);
    const bdStableWethPrice = await uniswapV2Router02.consult(bdStable.address, toErc20(1), constants.wETH_address);

    const wethInBdStablePriceDecimal = bigNumberToDecmal(wethInBdStablePrice, 18);
    const bdStableInWethPriceDecimal = bigNumberToDecmal(bdStableWethPrice, 18);

    console.log(`WETH in ${bdStableName} price: ` + wethInBdStablePriceDecimal);
    console.log(`${bdStableName} in WETH price: ` + bdStableInWethPriceDecimal);

    return [wethInBdStablePriceDecimal, bdStableInWethPriceDecimal];
}

async function updatePair(tokenName: string){
    const ownerUser = (await hre.getNamedAccounts()).DEPLOYER_ADDRESS
    const uniswapFactory = await hre.ethers.getContract("UniswapV2Factory", ownerUser) as unknown as UniswapV2Factory;

    const token = await hre.ethers.getContract(tokenName) as unknown as BDStable;

    const pairAddress = await uniswapFactory.getPair(token.address, constants.wETH_address);

    const pair = await hre.ethers.getContractAt("UniswapV2Pair", pairAddress) as unknown as UniswapV2Pair;

    await pair.updateOracle();
}

describe("Uniswap Oracles", async () => {
    before(async () => {
        await hre.deployments.fixture();
    });

    const poolCreatorUser = await hre.ethers.getNamedSigner('POOL_CREATOR');
    const ownerUser = (await hre.getNamedAccounts()).DEPLOYER_ADDRESS

    it("should get weth/bdeur price", async () => {
        const bdeur = await hre.ethers.getContract("BDEUR") as unknown as BDStable;

        const testUser1 = await hre.ethers.getNamedSigner('TEST1');
        
        await provideLiquidity_WETH_BDEUR(hre, 20, 80, testUser1);

        await deployUniswapOracle(hre, bdeur.address, "BDEUR");
        const bdeurWethOracle = await hre.ethers.getContract("UniswapPairOracle_BDEUR_WETH") as unknown as UniswapPairOracle;
        
        bdeur.setBDStable_WETH_Oracle(bdeurWethOracle.address);
        
        console.log(`Added BDEUR WETH Uniswap oracle`);

        const oracle = await hre.ethers.getContract(
            'UniswapPairOracle_BDEUR_WETH', 
            poolCreatorUser) as unknown as UniswapPairOracle;

        await simulateTimeElapseInDays(1);
        await oracle.update();
        
        const wethBdeurPrice = await oracle.consult(constants.wETH_address, toErc20(1));
        const bdeurWethPrice = await oracle.consult(bdeur.address, toErc20(1));
        
        const wethBdeurPriceDecimal = bigNumberToDecmal(wethBdeurPrice, 18);
        const bdeurWethPriceDecimal = bigNumberToDecmal(bdeurWethPrice, 18);

        console.log("WETH/BDEUR price: " + wethBdeurPriceDecimal);
        console.log("BDEUR/WETH price: " + bdeurWethPriceDecimal);

        expect(wethBdeurPriceDecimal).to.be.eq(4);
        expect(bdeurWethPriceDecimal).to.be.eq(0.25);
    });

    it("should get weth/bdx price", async () => {
        const bdeur = await hre.ethers.getContract("BDEUR") as unknown as BDStable;
        const bdx = await hre.ethers.getContract("BDXShares") as unknown as BDXShares;

        const testUser1 = await hre.ethers.getNamedSigner('TEST1');
        
        await provideLiquidity_BDX_WETH(hre, 20, 80, testUser1);

        await deployUniswapOracle(hre, bdx.address, "BDX");
        const bdxWethOracle = await hre.ethers.getContract("UniswapPairOracle_BDX_WETH") as unknown as UniswapPairOracle;
        
        bdeur.setBDStable_WETH_Oracle(bdxWethOracle.address);
        
        console.log(`Added BDX WETH Uniswap oracle`);

        const oracle = await hre.ethers.getContract(
            'UniswapPairOracle_BDX_WETH', 
            poolCreatorUser) as unknown as UniswapPairOracle;

        await simulateTimeElapseInDays(1);
        await oracle.update();
        
        const wethBdxPrice = await oracle.consult(constants.wETH_address, toErc20(1));
        const bdxWethPrice = await oracle.consult(bdx.address, toErc20(1));
        
        const wethBdxPriceDecimal = bigNumberToDecmal(wethBdxPrice, 18);
        const bdxWethPriceDecimal = bigNumberToDecmal(bdxWethPrice, 18);

        console.log("WETH/BDX price: " + wethBdxPriceDecimal);
        console.log("BDX/WETH price: " + bdxWethPriceDecimal);

        expect(wethBdxPriceDecimal).to.be.eq(4);
        expect(bdxWethPriceDecimal).to.be.eq(0.25);
    })

    it("should update price after swap", async () => {

        const testUserLiquidityProvider = await hre.ethers.getNamedSigner('TEST1');

        await provideLiquidity_WETH_BDEUR(hre, 20, 80, testUserLiquidityProvider);
        await simulateTimeElapseInDays(1);

        await swapWethFor("BDEUR", 5);
        const [wethInBdStablePriceDecimal1, bdStableInWethPriceDecimal1] = await getPrices("BDEUR");

        // swap triggers price update based on PREVIOUS reserves and time elapased since PREVIOUS update
        expect(wethInBdStablePriceDecimal1).to.be.eq(4);
        expect(bdStableInWethPriceDecimal1).to.be.eq(0.25);

        await simulateTimeElapseInDays(1);

        await swapWethFor("BDEUR", 1);
        const [wethInBdStablePriceDecimal2, bdStableInWethPriceDecimal2]  = await getPrices("BDEUR");

        expect(wethInBdStablePriceDecimal2).to.be.lt(wethInBdStablePriceDecimal1);
        expect(bdStableInWethPriceDecimal2).to.be.gt(bdStableInWethPriceDecimal1);
    });

    it.only("should not update price before one hour elapses", async () => {

        const testUserLiquidityProvider = await hre.ethers.getNamedSigner('TEST1');

        await provideLiquidity_WETH_BDEUR(hre, 20, 80, testUserLiquidityProvider);
        await simulateTimeElapseInSeconds(60*60+1);

        await swapWethFor("BDEUR", 5);
        const [wethInBdStablePriceDecimal1, bdStableInWethPriceDecimal1] = await getPrices("BDEUR");

        await simulateTimeElapseInSeconds(60);

        await swapWethFor("BDEUR", 15);
        const [wethInBdStablePriceDecimal2, bdStableInWethPriceDecimal2]  = await getPrices("BDEUR");

        expect(wethInBdStablePriceDecimal2).to.be.eq(wethInBdStablePriceDecimal1);
        expect(bdStableInWethPriceDecimal2).to.be.eq(bdStableInWethPriceDecimal1);

        await simulateTimeElapseInSeconds(60*60+1);

        await updatePair("BDEUR");
        await swapWethFor("BDEUR", 1);
        const [wethInBdStablePriceDecimal3, bdStableInWethPriceDecimal3] = await getPrices("BDEUR");

        expect(wethInBdStablePriceDecimal3).to.be.lt(wethInBdStablePriceDecimal1);
        expect(bdStableInWethPriceDecimal3).to.be.gt(bdStableInWethPriceDecimal1);
    });
})