import { task } from "hardhat/config";
import { BigNumber } from "ethers";
import {
  formatAddress,
  getBdEu,
  getBdx,
  getDeployer,
  getTreasury,
  getWbtc,
  getWeth,
  getWethConcrete,
  mintWbtc,
  mintWeth
} from "../utils/DeployedContractsHelpers";
import { d12_ToNumber, d18_ToNumber, to_d12, to_d18, to_d8 } from "../utils/NumbersHelpers";
import { simulateTimeElapseInSeconds } from "../utils/HelpersHardhat";
import type { IMoCBaseOracle } from "../typechain/IMoCBaseOracle";
import type { ISovrynLiquidityPoolV1Converter } from "../typechain/ISovrynLiquidityPoolV1Converter";
import type { ISovrynAnchor } from "../typechain/ISovrynAnchor";
import type { ISovrynSwapNetwork } from "../typechain/ISovrynSwapNetwork";
import { RSK_SOVRYN_NETWORK } from "../utils/Constants";
import { readdir, mkdirSync, writeFileSync } from "fs";
import * as rimraf from "rimraf";
import * as fsExtra from "fs-extra";
import { default as klaw } from "klaw-sync";

export function load() {
  task("mint-wrbtc-rsk", "", async (args, hre) => {
    const treasury = await getTreasury(hre);
    const wrbtc = await getWethConcrete(hre);

    await (await wrbtc.connect(treasury).deposit({ value: to_d18(0.001) })).wait();
  });

  task("slow-down-mining", "Slows down mining on local fork", async (args, hre) => {
    if (hre.network.name !== "mainnetFork") {
      throw new Error("this task can run only on mainnetFork");
    }
    await hre.ethers.provider.send("evm_setAutomine", [false]);
    await hre.ethers.provider.send("evm_setIntervalMining", [60000]);
  });

  task("speed-up-mining", "Speeds up mining on local fork", async (args, hre) => {
    if (hre.network.name !== "mainnetFork") {
      throw new Error("this task can run only on mainnetFork");
    }
    await hre.ethers.provider.send("evm_setAutomine", [true]);
  });

  task("mine-one-block", "Mine one block on local fork", async (args, hre) => {
    if (hre.network.name !== "mainnetFork") {
      throw new Error("this task can run only on mainnetFork");
    }
    console.log("blockNumber before mine", await hre.ethers.provider.getBlockNumber());
    await hre.ethers.provider.send("evm_mine", []);
    console.log("blockNumber after mine", await hre.ethers.provider.getBlockNumber());
  });

  task("accounts", "Prints the list of accounts", async (args, hre) => {
    const accounts = await hre.ethers.getSigners();

    for (const account of accounts) {
      console.log(account.address);
    }
  });

  task("test:dir")
    .addFlag("deployFixture", "run the global fixture before tests")
    .addPositionalParam("testDir", "Directory with *.ts files. Sholud end with '/'")
    .setAction(async ({ testDir, noCompile, deployFixture }, { run }) => {
      const testFiles: string[] = [];
      readdir(testDir, (_err: NodeJS.ErrnoException | null, files: string[]) => {
        files.forEach(file => {
          if (file.endsWith(".ts")) {
            file = testDir + file;
            testFiles.push(file);
          }
        });
      });

      await run("test", { testFiles, noCompile, deployFixture });
    });

  task("npm-package", "Packages type definitions and abis into npm package").setAction(async () => {
    try {
      rimraf.sync("./package");
    } catch {
      console.log("COuldn't sync folder using 'rimraf.sync'");
    }
    mkdirSync("./package");
    fsExtra.copySync("./typechain", "./package/typings");
    const contracts = klaw("./artifacts/contracts")
      .filter((x: { path: string }) => x.path.endsWith(".json") && !x.path.endsWith(".dbg.json"))
      .map((x: { path: string }) => {
        const { abi, contractName: name } = fsExtra.readJsonSync(x.path);
        return { abi, name };
      });
    mkdirSync("./package/abis");
    for (const contract of contracts) {
      writeFileSync(`./package/abis/${contract.name}.json`, JSON.stringify(contract.abi), {
        encoding: "utf8"
      });
    }
    fsExtra.writeJsonSync("./package/package.json", {
      name: "@blindex/stablecoins",
      version: "0.0.1",
      types: "typings/index.d.ts"
    });
  });

  task("setup:account").setAction(async (args, hre) => {
    // send ether
    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: ["0xbe0eb53f46cd790cd13851d5eff43d12404d33e8"]
    });

    const signer = await hre.ethers.getSigner("0xbe0eb53f46cd790cd13851d5eff43d12404d33e8");

    const resp = await signer.sendTransaction({ to: "0x774289Cb40c98B4f5b64a152BF7e5F94Fee38669", value: hre.ethers.utils.parseEther("7.5") });
    console.log(resp);

    // send dai
    const dai = "0x6b175474e89094c44da98b954eedeac495271d0f";
    const bigDaiHolder = "0x66c57bf505a85a74609d2c83e94aabb26d691e1f";
    await hre.ethers.provider.send("hardhat_impersonateAccount", [bigDaiHolder]);
    const signerLink = hre.ethers.provider.getSigner(bigDaiHolder);
    const DaiContractFactory = await hre.ethers.getContractFactory("ERC20", signerLink);
    const DaiContract = DaiContractFactory.attach(dai);
    await DaiContract.transfer("0x774289Cb40c98B4f5b64a152BF7e5F94Fee38669", BigNumber.from("10000000000000000000"));
    await hre.ethers.provider.send("hardhat_stopImpersonatingAccount", [bigDaiHolder]);
  });

  task("setup:feed-test-user")
    .addPositionalParam("address", "receiver address")
    .setAction(async ({ address }, hre) => {
      const deployer = await getDeployer(hre);

      const weth = await getWeth(hre);
      const wbtc = await getWbtc(hre);

      await deployer.sendTransaction({ to: address, value: hre.ethers.utils.parseEther("7.5") });
      await mintWeth(hre, deployer, to_d18(200));
      await mintWbtc(hre, deployer, to_d8(10), 100);

      await (await weth.transfer(address, to_d18(1))).wait();
      await (await wbtc.transfer(address, to_d8(1))).wait();
    });

  task("setup:test-user-balance-ag").setAction(async (args, hre) => {
    const weth = await getWeth(hre);
    const wbtc = await getWbtc(hre);
    const bdx = await getBdx(hre);
    const bdeu = await getBdEu(hre);

    const testUserAddress = "0xED3622f02b1619d397502a9FFF1dfe3d0fB2988c";

    console.log("weth: " + (await weth.balanceOf(testUserAddress)));
    console.log("wbtc: " + (await wbtc.balanceOf(testUserAddress)));
    console.log("bdx: " + (await bdx.balanceOf(testUserAddress)));
    console.log("bdeu: " + (await bdeu.balanceOf(testUserAddress)));
  });

  task("simulateTimeElapse").setAction(async () => {
    await simulateTimeElapseInSeconds(3600 * 24 * 365 * 6);
  });

  task("show:moc-feeds").setAction(async (args, hre) => {
    async function showFor(address: string, priceName: string) {
      const feed = (await hre.ethers.getContractAt("IMoCBaseOracle", formatAddress(hre, address))) as IMoCBaseOracle;
      const [price_d18_str] = await feed.peek();
      console.log(priceName + ": " + d18_ToNumber(BigNumber.from(price_d18_str)));
    }

    await showFor("0x972a21C61B436354C0F35836195D7B67f54E482C", "BTC/USD");
    await showFor("0x84c260568cFE148dBcFb4C8cc62C4e0b6d998F91", "ETH/USD");
  });

  task("show:sovryn-swap-prices").setAction(async (args, hre) => {
    async function run(token1: string, token2: string, token1Name: string, token2Name: string) {
      const swapNetwork = (await hre.ethers.getContractAt("ISovrynSwapNetwork", formatAddress(hre, RSK_SOVRYN_NETWORK))) as ISovrynSwapNetwork;

      // format:  token1 - acnchor_A - token2
      const conversionPath = await swapNetwork.conversionPath(token1, token2);

      console.log("path length: " + conversionPath.length);

      if (conversionPath.length !== 3) {
        throw `conversion path should be 3, but is ${conversionPath.length}`;
      }

      for (const a of conversionPath) {
        console.log(a);
      }

      const anchorAddress = conversionPath[1];
      const anchor = (await hre.ethers.getContractAt("ISovrynAnchor", formatAddress(hre, anchorAddress))) as ISovrynAnchor;

      const lpAddress = await anchor.owner();
      console.log(`lp ${token1Name}-${token2Name}: ` + lpAddress);

      const lpBtcEth = (await hre.ethers.getContractAt(
        "ISovrynLiquidityPoolV1Converter",
        formatAddress(hre, lpAddress)
      )) as ISovrynLiquidityPoolV1Converter;

      const res1 = await lpBtcEth.targetAmountAndFee(token1, token2, to_d12(1));
      console.log(`${token1Name}/${token2Name}: ` + d12_ToNumber(res1.amountMinusFee.add(res1.fee)));
      const res2 = await lpBtcEth.targetAmountAndFee(token2, token1, to_d12(1));
      console.log(`${token2Name}/${token1Name}: ` + d12_ToNumber(res2.amountMinusFee.add(res2.fee)));
    }

    const rusdtAddress = "0xef213441a85df4d7acbdae0cf78004e1e486bb96";
    const wrbtcAddress = "0x542fda317318ebf1d3deaf76e0b632741a7e677d";
    const ethsAddress = "0x1d931bf8656d795e50ef6d639562c5bd8ac2b78f";

    await run(ethsAddress, wrbtcAddress, "eth", "btc");
    await run(rusdtAddress, wrbtcAddress, "usd", "btc");
  });
}
