import hre from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import cap from "chai-as-promised";
import { d18_ToNumber, to_d18 } from "../../utils/NumbersHelpers";
import { getBdEu, getBdx, getDeployer, getUniswapRouter, getWeth } from "../../utils/DeployedContractsHelpers";
import { setUpFunctionalSystemForTests } from "../../utils/SystemSetup";
import type { BigNumber } from "ethers";
import { getPools } from "../../utils/UniswapPoolsHelpers";

chai.use(cap);

chai.use(solidity);
const { expect } = chai;

describe("Swaps", () => {
  beforeEach(async () => {
    await hre.deployments.fixture();
    await setUpFunctionalSystemForTests(hre, 1);
  });

  it("Should swap direct path", async () => {
    const deployer = await getDeployer(hre);
    const currentBlock = await hre.ethers.provider.getBlock("latest");

    const bdx = await getBdx(hre);
    const weth = await getWeth(hre);
    const router = await getUniswapRouter(hre);

    weth.approve(router.address, to_d18(1));
    await router.swapExactTokensForTokens(to_d18(1), 0, [weth.address, bdx.address], deployer.address, currentBlock.timestamp + 1e5);
  });

  it("Should swap indirect path", async () => {
    const deployer = await getDeployer(hre);

    const bdx = await getBdx(hre);
    const bdeu = await getBdEu(hre);
    const weth = await getWeth(hre);

    const router = await getUniswapRouter(hre);

    const amountIn = to_d18(0.0001);

    const path = [weth.address, bdeu.address, bdx.address];

    weth.approve(router.address, amountIn);
    const currentBlock = await hre.ethers.provider.getBlock("latest");
    await router.swapExactTokensForTokens(amountIn, 0, path, deployer.address, currentBlock.timestamp + 1e5);
  });

  it("Should choose best path (length 3)", async () => {
    const deployer = await getDeployer(hre);

    const bdx = await getBdx(hre);
    const weth = await getWeth(hre);
    const router = await getUniswapRouter(hre);

    const currentBlock = await hre.ethers.provider.getBlock("latest");

    // sabotage the price on the direct swap, so the algorithm prefers an indirect path
    const amountInForSabotage = to_d18(10);
    console.log("amountInForSabotage:", d18_ToNumber(amountInForSabotage));
    await weth.approve(router.address, amountInForSabotage);
    await router.swapExactTokensForTokens(amountInForSabotage, 0, [weth.address, bdx.address], deployer.address, currentBlock.timestamp + 1e5);

    const amountIn = to_d18(0.0001);

    const pathsPrices = await generatePaths(amountIn, weth.address, bdx.address);
    console.log(
      pathsPrices.map(x => ({
        path: x.path,
        amountOut: d18_ToNumber(x.amountOut)
      }))
    );

    const bestPath = await chooseBestPath(pathsPrices);
    console.log(d18_ToNumber(bestPath.amountOut));
    expect(bestPath.path.length).to.eq(3);

    weth.approve(router.address, amountIn);
    await router.swapExactTokensForTokens(amountIn, 0, bestPath.path, deployer.address, currentBlock.timestamp + 1e5);
  });

  async function getAvailableSwapLinks() {
    const pools = await getPools(hre);

    const availableLinks = [];

    for (const pool of pools) {
      availableLinks.push({ from: pool[0].token.address, to: pool[1].token.address });
      availableLinks.push({ from: pool[1].token.address, to: pool[0].token.address });
    }

    return availableLinks;
  }

  async function generatePaths(amountIn: BigNumber, addressIn: string, addressOut: string): Promise<{ path: string[]; amountOut: BigNumber }[]> {
    const availableSwapLinks = await getAvailableSwapLinks();

    const midTokens = [];

    for (const link1 of availableSwapLinks) {
      if (link1.from !== addressIn) {
        continue;
      }
      for (const link2 of availableSwapLinks) {
        if (link1.to !== link2.from) {
          continue;
        }
        if (link2.to !== addressOut) {
          continue;
        }

        midTokens.push(link1.to);
      }
    }

    const paths = [[addressIn, addressOut], ...midTokens.map(x => [addressIn, x, addressOut])];

    const router = await getUniswapRouter(hre);
    const pathsPrices = [];

    for (const path of paths) {
      let amountsOut;
      try {
        amountsOut = await router.getAmountsOut(amountIn, path);
      } catch {
        continue; // handle unsupported paths like [wrbtc -> eths -> bdx]
      }

      pathsPrices.push({
        path: path,
        amountOut: amountsOut[amountsOut.length - 1]
      });
    }

    return pathsPrices;
  }

  async function chooseBestPath(pathsPrices: { amountOut: BigNumber; path: string[] }[]) {
    const bestPath = pathsPrices.reduce((prev, current) => (prev.amountOut > current.amountOut ? prev : current));
    return bestPath;
  }
});
