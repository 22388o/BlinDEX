import { task } from "hardhat/config";
import {
  getBdx,
  getDeployer,
  getStakingRewardsDistribution,
  getUniswapFactory,
  getUniswapRouter,
  getVesting,
  getWeth,
  getBDStableWethPool,
  getBDStableWbtcPool,
  getBDStableFiat,
  getAllBDStables,
  getWbtc,
  getTreasury,
  getOperationalTreasury
} from "../utils/DeployedContractsHelpers";
import type { UniswapV2Pair } from "../typechain/UniswapV2Pair";
import type { ERC20 } from "../typechain/ERC20";
import { d12_ToNumber } from "../utils/NumbersHelpers";
import type { BdStablePool } from "../typechain/BdStablePool";
import type { StakingRewards } from "../typechain/StakingRewards";
import type { HardhatRuntimeEnvironment } from "hardhat/types";
import type { SignerWithAddress } from "hardhat-deploy-ethers/dist/src/signers";
import { PriceFeedContractNames } from "../deploy/7_deploy_price_feeds";
import { cleanStringify } from "../utils/StringHelpers";
import type { BDStable } from "../typechain/BDStable";
import { getPoolKey, getPools } from "../utils/UniswapPoolsHelpers";
import { readFileSync, readdirSync } from "fs";
import type { Contract } from "ethers";
import {
  NATIVE_TOKEN_NAME,
  SECONDARY_COLLATERAL_TOKEN_NAME,
  EXTERNAL_USD_STABLE,
  rskTreasuryAddress,
  bdxLockingContractAddressRSK,
  rskOperationalTreasuryAddress,
  rskMultisigTreasuryAddress
} from "../utils/Constants";

export function load() {
  task("show:be-config").setAction(async (args, hre) => {
    const deployer = await getDeployer(hre);
    const stakingRewards = (await getStakingsConfig(hre)).map(reward => {
      return {
        pairAddress: reward.stakingTokenAddress,
        stakingRewardAddress: reward.address,
        isTrueBdPool: reward.isTrueBdPool,
        isPaused: reward.isPaused,
        token0Address: reward.token0Address,
        token1Address: reward.token1Address,
        token0Symbol: reward.token0Symbol,
        token1Symbol: reward.token1Symbol
      };
    });

    const pairOracles = await getPairsOraclesAndSymbols(hre, deployer);

    const swapPairs = pairOracles.map(pairOracle => {
      return {
        pairAddress: pairOracle.pair.address,
        token0Address: pairOracle.pair.token0,
        token1Address: pairOracle.pair.token1,
        token0Symbol: pairOracle.pair.token0Symbol,
        token1Symbol: pairOracle.pair.token1Symbol
      };
    });

    const mappedPairOracles = pairOracles.map(pairOracle => {
      return {
        pairAddress: pairOracle.pair.address,
        oracleAddress: pairOracle.pairOracle.oracleAddress,
        token0Address: pairOracle.pair.token0,
        token1Address: pairOracle.pair.token1,
        token0Symbol: pairOracle.pair.token0Symbol,
        token1Symbol: pairOracle.pair.token1Symbol
      };
    });

    const pairSymbols = pairOracles.map(po => po.symbol);

    const networkName = hre.network.name.toUpperCase();

    const blockchainConfig = {
      [`${networkName}`]: {
        [`UNISWAP_FACTORY_ADDRESS`]: (await getUniswapFactory(hre)).address,
        [`BDX_ADDRESS`]: (await getBdx(hre)).address,
        [`STAKING_REWARDS_DISTRIBUTION_ADDRESS`]: (await getStakingRewardsDistribution(hre)).address,
        [`AVAILABLE_PAIR_SYMBOLS`]: pairSymbols,
        [`BDX_CIRCULATING_SUPPLY_IGNORE_ADDRESSES`]:
          networkName === "RSK"
            ? [rskTreasuryAddress, rskOperationalTreasuryAddress, rskMultisigTreasuryAddress, bdxLockingContractAddressRSK]
            : [(await getTreasury(hre)).address, (await getOperationalTreasury(hre)).address],
        [`AVAILABLE_PAIRS`]: swapPairs,
        [`STAKING_REWARDS`]: stakingRewards,
        [`PAIR_ORACLES`]: mappedPairOracles,
        [`PRICE_FEEDS`]: await getPriceFeedsConfig(hre, deployer),
        [`UPDATER_RSK_ADDRESS`]: (await hre.ethers.getContract("UpdaterRSK", deployer)).address,
        [`BDSTABLES`]: await getStablesConfig(hre)
      }
    };

    console.log(
      "Please make sure to run hardhat with the appropriate network you wanted to get the BE configuration for (npx hardhat --network <network_name> show:be-config)\n"
    );
    console.log(cleanStringify(blockchainConfig));
  });

  task("show:fe-config").setAction(async (args, hre) => {
    const deployer = await getDeployer(hre);
    const allStables = await getAllBDStables(hre);
    const stakingRewardsDistribution = await getStakingRewardsDistribution(hre);

    const stables = await getStablesConfig(hre);
    const swaps = await getSwapsConfig(hre, deployer);
    const stakings = await getStakingsConfig(hre);
    const weth = await getWeth(hre);
    const bdx = await getBdx(hre);
    const erc20Info = await getErc20Info(
      hre,
      stables.map(x => x.address),
      swaps.map(x => x.address)
    );

    const blockchainConfig = {
      STABLES: stables,
      SWAPS: swaps,
      STAKING_REWARDS: stakings,
      WETH: weth.address,
      BDX: bdx.address,
      SWAP_ROUTER: (await getUniswapRouter(hre)).address,
      SWAP_FACTORY: (await getUniswapFactory(hre)).address,
      STAKING_REWARDS_DISTRIBUTION: stakingRewardsDistribution.address,
      VESTING: (await getVesting(hre)).address,
      BD_STABLES: allStables.map((stable: BDStable) => stable.address),
      PRICE_FEED_EUR_USD: (await hre.ethers.getContract(PriceFeedContractNames.EUR_USD, deployer)).address,
      BTC_TO_ETH_ORACLE: (await hre.ethers.getContract(PriceFeedContractNames.BTC_ETH, deployer)).address,
      ERC20_INFO: erc20Info
    };

    console.log(cleanStringify(blockchainConfig));
  });

  task("show:contracts-doc").setAction(async () => {
    readdirSync("./deployments/rsk").forEach((file: string) => {
      const isContract = file.endsWith(".json") && !file.includes("_Proxy") && !file.includes("_Implementation") && file !== ".migrations.json";

      if (isContract) {
        const contractObject = JSON.parse(readFileSync(`./deployments/rsk/${file}`, "utf8"));
        const contractName = file.replace(".json", "");

        console.log(`${contractName}: ${contractObject.address}`);
      }
    });
  });

  async function getPriceFeedsConfig(hre: HardhatRuntimeEnvironment, deployer: SignerWithAddress) {
    const priceFeeds = Object.entries(PriceFeedContractNames).map(async ([key, value]) => {
      const instance = await hre.ethers.getContract(value, deployer);
      return { symbol: key, address: instance.address, decimals: await getDecimals(instance) };
    });

    const results = await Promise.all(priceFeeds);
    return results;
  }

  async function getDecimals(instance: Contract): Promise<number | undefined> {
    if (instance.decimals) {
      return await instance.decimals();
    } else if (instance.getDecimals) {
      return await instance.getDecimals();
    } else {
      return undefined;
    }
  }

  async function getPairsOraclesAndSymbols(hre: HardhatRuntimeEnvironment, deployer: SignerWithAddress) {
    const factory = await getUniswapFactory(hre);
    const pools = await getPools(hre);

    const pairInfos: {
      pair: { address: string; token0: string; token1: string; token0Symbol: string; token1Symbol: string };
      pairOracle: { pairAddress: string; oracleAddress: string };
      symbol: string;
    }[] = [];
    for (const poolPair of pools) {
      let pairSymbol = getPoolKey(poolPair[0].token.address, poolPair[1].token.address, poolPair[0].name, poolPair[1].name);
      let token0Symbol = poolPair[0].name;
      let token1Symbol = poolPair[1].name;
      const pairAddress = await factory.getPair(poolPair[0].token.address, poolPair[1].token.address);
      const oracleAddress = (await hre.ethers.getContract(`UniswapPairOracle_${pairSymbol}`, deployer)).address;
      const etherOriginalTokenNamesNetworks = ["mainnetFork", "ethereum"];

      // Our uniswap contracts were deployed with the names WETH & WBTC instead of RSK's names (WRBTC & ETHs)
      if (!etherOriginalTokenNamesNetworks.includes(hre.network.name)) {
        pairSymbol = pairSymbol
          .replace(NATIVE_TOKEN_NAME["mainnetFork"], NATIVE_TOKEN_NAME[hre.network.name])
          .replace(`W${SECONDARY_COLLATERAL_TOKEN_NAME["mainnetFork"]}`, SECONDARY_COLLATERAL_TOKEN_NAME[hre.network.name]);
        token0Symbol = token0Symbol
          .replace(NATIVE_TOKEN_NAME["mainnetFork"], NATIVE_TOKEN_NAME[hre.network.name])
          .replace(`W${SECONDARY_COLLATERAL_TOKEN_NAME["mainnetFork"]}`, SECONDARY_COLLATERAL_TOKEN_NAME[hre.network.name]);
        token1Symbol = token1Symbol
          .replace(NATIVE_TOKEN_NAME["mainnetFork"], NATIVE_TOKEN_NAME[hre.network.name])
          .replace(`W${SECONDARY_COLLATERAL_TOKEN_NAME["mainnetFork"]}`, SECONDARY_COLLATERAL_TOKEN_NAME[hre.network.name]);
      }

      pairInfos.push({
        pair: {
          address: pairAddress,
          token0: poolPair[0].token.address,
          token1: poolPair[1].token.address,
          token0Symbol,
          token1Symbol
        },
        pairOracle: { pairAddress: pairAddress, oracleAddress: oracleAddress },
        symbol: pairSymbol
      });
    }

    return pairInfos;
  }

  async function getStakingsConfig(hre: HardhatRuntimeEnvironment) {
    const stakingRewardsDistribution = await getStakingRewardsDistribution(hre);

    const stakingRewardsAddresses = [];
    for (let i = 0; i < 100; i++) {
      try {
        const address = await stakingRewardsDistribution.stakingRewardsAddresses(i);
        stakingRewardsAddresses.push(address);
      } catch (ex) {
        break;
      }
    }

    const stakings = await Promise.all(
      stakingRewardsAddresses.map(async address => {
        const stakingRewards = (await hre.ethers.getContractAt("StakingRewards", address)) as StakingRewards;
        const stakingTokenAddress = await stakingRewards.stakingToken();

        const lpAddress = await stakingRewards.stakingToken();
        const stakingTokenDecimals = (await stakingRewards.stakingDecimals()).toNumber();
        const isTrueBdPool = await stakingRewards.isTrueBdPool();
        const isPaused = await stakingRewards.paused();
        const rewardForDuration = (await stakingRewards.getRewardForDuration()).toString();
        const lp = (await hre.ethers.getContractAt("UniswapV2Pair", lpAddress)) as UniswapV2Pair;
        const token0Address = await lp.token0();
        const token1Address = await lp.token1();
        const token0 = (await hre.ethers.getContractAt("ERC20", token0Address)) as ERC20;
        const token1 = (await hre.ethers.getContractAt("ERC20", token1Address)) as ERC20;

        return {
          address,
          stakingTokenDecimals,
          isTrueBdPool,
          isPaused,
          rewardForDuration,
          stakingTokenAddress: stakingTokenAddress,
          token0Address: token0.address,
          token1Address: token1.address,
          token0Symbol: (await token0.symbol()).toUpperCase(),
          token1Symbol: (await token1.symbol()).toUpperCase()
        };
      })
    );

    return stakings;
  }

  async function getSwapsConfig(hre: HardhatRuntimeEnvironment, deployer: SignerWithAddress) {
    const swaps = (await getPairsOraclesAndSymbols(hre, deployer)).map(pairInfo => pairInfo.pair);
    return swaps;
  }

  async function getStablesConfig(hre: HardhatRuntimeEnvironment) {
    const allStables = await getAllBDStables(hre);

    const stableConfigs = [];
    for (const stable of allStables) {
      const symbol = await stable.symbol();
      const pools: BdStablePool[] = [await getBDStableWethPool(hre, symbol), await getBDStableWbtcPool(hre, symbol)];

      const stablePools = await Promise.all(
        pools.map(async pool => {
          const [mintingFee, redemptionFee, collateralAddress, recollateralizeFee, recollateralizeBonus] = await Promise.all([
            pool.minting_fee(),
            pool.redemption_fee(),
            pool.collateral_token(),
            pool.recollat_fee(),
            pool.bonus_rate()
          ]);

          return {
            address: pool.address,
            collateralAddress: collateralAddress.toString(),
            mintingFee: d12_ToNumber(mintingFee),
            redemptionFee: d12_ToNumber(redemptionFee),
            recollateralizeFee: d12_ToNumber(recollateralizeFee),
            recollateralizeBonus: d12_ToNumber(recollateralizeBonus)
          };
        })
      );

      stableConfigs.push({
        symbol: await stable.symbol(),
        decimals: await stable.decimals(),
        address: stable.address,
        fiat: getBDStableFiat(symbol),
        pools: await stablePools
      });
    }

    return stableConfigs;
  }

  async function getErc20Info(hre: HardhatRuntimeEnvironment, stablesAddresses: string[], swapsAddresses: string[]) {
    const weth = await getWeth(hre);
    const wbtc = await getWbtc(hre);
    const bdx = await getBdx(hre);

    const addresses = [
      bdx.address,
      weth.address,
      wbtc.address,
      EXTERNAL_USD_STABLE[hre.network.name].address,
      ...stablesAddresses,
      ...swapsAddresses
    ];

    const contractsData = await Promise.all(
      addresses.map(async address => {
        const contact = (await hre.ethers.getContractAt("ERC20", address)) as ERC20;

        return {
          address: address,
          symbol: await contact.symbol(),
          decimals: await contact.decimals()
        };
      })
    );

    return contractsData;
  }
}
