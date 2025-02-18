import type { HardhatRuntimeEnvironment } from "hardhat/types";
import type { DeployFunction } from "hardhat-deploy/types";
import { getWeth, getWbtc, getBdx, getUniswapFactory, getBdEu, getBdUs } from "../utils/DeployedContractsHelpers";
import { deployPairOracle } from "../utils/DeploymentHelpers";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  console.log("Starting deployment: liquidity pools");

  const bdx = await getBdx(hre);
  const factory = await getUniswapFactory(hre);
  const wethAddress = (await getWeth(hre)).address;
  const wbtcAddress = (await getWbtc(hre)).address;

  const bdEu = await getBdEu(hre);
  const bdUs = await getBdUs(hre);
  const stables = [bdEu, bdUs];

  await (await factory.createPair(bdx.address, wethAddress)).wait();
  await deployPairOracle(hre, "BDX", "WETH", bdx.address, wethAddress);

  await (await factory.createPair(bdx.address, wbtcAddress)).wait();
  await deployPairOracle(hre, "BDX", "WBTC", bdx.address, wbtcAddress);

  for (const bdStable of stables) {
    const symbol = await bdStable.symbol();

    await (await factory.createPair(bdx.address, bdStable.address)).wait();
    await deployPairOracle(hre, "BDX", symbol, bdx.address, bdStable.address);

    await (await factory.createPair(bdStable.address, wethAddress)).wait();
    await deployPairOracle(hre, symbol, "WETH", bdStable.address, wethAddress);

    await (await factory.createPair(bdStable.address, wbtcAddress)).wait();
    await deployPairOracle(hre, symbol, "WBTC", bdStable.address, wbtcAddress);
  }

  await (await factory.createPair(bdEu.address, bdUs.address)).wait();
  await deployPairOracle(hre, await bdEu.symbol(), await bdUs.symbol(), bdEu.address, bdUs.address);
  console.log(`Created BDEU/BDUS liquidity pool pair`);

  console.log("Finished deployment: liquidity pools");

  // One time migration
  return true;
};
func.id = __filename;
func.tags = ["LiquidityPools"];
func.dependencies = ["BDX", "BdxMint", "UniswapHelpers", "BDUS", "BDEU"];
export default func;
