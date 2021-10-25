import hre from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import cap from "chai-as-promised";
import { diffPct, to_d12, to_d8 } from "../../utils/Helpers";
import { to_d18, d18_ToNumber, d12_ToNumber, bigNumberToDecimal } from "../../utils/Helpers"
import { getBdEu, getBdx, getWeth, getWbtc, getBdEuWbtcPool, getBdEuWethPool, getDeployer, getUser } from "../helpers/common";
import { setUpFunctionalSystem } from "../helpers/SystemSetup";
chai.use(cap);

chai.use(solidity);
const { expect } = chai;

describe("Collateral price", () => {

    beforeEach(async () => {
        await hre.deployments.fixture();
    });

    it("should get price for weth", async () => {

        await setUpFunctionalSystem(hre, 1);

        const wethPool = await getBdEuWethPool(hre);

        const expectedWethPrice = 3600; //ETH-EUR for 2021-10-25
        const precision = 0.33;
        const wethInEurPrice = d12_ToNumber(await wethPool.getCollateralPrice_d12());

        console.log("wethInEurPrice: " + wethInEurPrice);
        expect(wethInEurPrice).to.be.closeTo(expectedWethPrice, expectedWethPrice * precision);
    });

    it("should get price for wbtc", async () => {

        await setUpFunctionalSystem(hre, 1);

        const wbtcPool = await getBdEuWbtcPool(hre);

        const expectedWbtcPrice = 54000; // BTC-EUR for 2021-10-25
        const precision = 0.33;
        const wbtcInEurPrice = d12_ToNumber(await wbtcPool.getCollateralPrice_d12());

        console.log("wbtcInEurPrice: " + wbtcInEurPrice);
        expect(wbtcInEurPrice).to.be.closeTo(expectedWbtcPrice, expectedWbtcPrice * precision);
    });
})
