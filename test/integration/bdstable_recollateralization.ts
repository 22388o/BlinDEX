import hre from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import cap from "chai-as-promised";
import { diffPct, to_d12, to_d8 } from "../../utils/Helpers";
import { to_d18 as to_d18, d18_ToNumber, bigNumberToDecimal } from "../../utils/Helpers"
import { getBdEu, getBdx, getWeth, getWbtc, getBdEuWbtcPool, getBdEuWethPool, getDeployer, getUser } from "../helpers/common";
import { setUpFunctionalSystem } from "../helpers/SystemSetup";
import { lockBdEuCrAt } from "../helpers/bdStable";
import * as constants from '../../utils/Constants';

chai.use(cap);

chai.use(solidity);
const { expect } = chai;

describe("Recollateralization", () => {

    beforeEach(async () => {
        await hre.deployments.fixture();
        const bdEuWethPool = await getBdEuWethPool(hre);
        await bdEuWethPool.toggleRecollateralizeOnlyForOwner(); // now every user can recollateralize
    });

    it("should recollateralize when efCR < CR", async () => {

        await setUpFunctionalSystem(hre, 0.4);

        const testUser = await getUser(hre);

        const bdx = await getBdx(hre);
        const weth = await getWeth(hre);
        const bdEu = await getBdEu(hre);
        const bdEuWethPool = await getBdEuWethPool(hre);

        await lockBdEuCrAt(hre, 0.7);

        await weth.connect(testUser).deposit({value: to_d18(100)  });

        const wethPoolBalanceBeforeRecolat_d18 = await weth.balanceOf(bdEuWethPool.address);
        const wethUserBalanceBeforeRecolat_d18 = await weth.balanceOf(testUser.address);
        
        const bdxInEurPrice_d12 = await bdEu.BDX_price_d12();
        const wethInEurPrice_d12 = await bdEuWethPool.getCollateralPrice_d12();

        const bdEuCollatrValue_d18 = await bdEu.globalCollateralValue();
        const maxPossibleRecollateralInEur_d18 = (constants.initalBdStableToOwner_d18[hre.network.name].sub(bdEuCollatrValue_d18))
            .mul(1e12).div(wethInEurPrice_d12);

        // recollateralization
        const toRecollatInEur_d18 = maxPossibleRecollateralInEur_d18.div(2);
        const toRecollatInEth_d18 = toRecollatInEur_d18.mul(1e12).div(wethInEurPrice_d12);
        const toRecollatInEth = d18_ToNumber(toRecollatInEth_d18);
        
        const bdxBalanceBeforeRecolat_d18 = await bdx.balanceOf(testUser.address);
        const bdEuBdxBalanceBeforeRecolat_d18 = await bdx.balanceOf(bdEu.address);

        await weth.connect(testUser).approve(bdEuWethPool.address, toRecollatInEth_d18); 
        await bdEuWethPool.connect(testUser).recollateralizeBdStable(toRecollatInEth_d18, 1);

        const bdxBalanceAfterRecolat_d18 = await bdx.balanceOf(testUser.address);

        // asserts
    
        const wethPoolBalanceAfterRecolat_d18 = await weth.balanceOf(bdEuWethPool.address);
        console.log("wethPoolBalanceBeforeRecolat_d18: " + wethPoolBalanceBeforeRecolat_d18);
        console.log("wethPoolBalanceAfterRecolat_d18:  " + wethPoolBalanceAfterRecolat_d18);
        const wethPoolBalanceDelta_d18 = wethPoolBalanceAfterRecolat_d18.sub(wethPoolBalanceBeforeRecolat_d18);
        console.log("wethPoolBalanceDelta_d18:         " + wethPoolBalanceDelta_d18);
        const wethPoolBalanceDelta = d18_ToNumber(wethPoolBalanceDelta_d18);
        expect(wethPoolBalanceDelta).to.be.closeTo(toRecollatInEth, 0.001, "invalid wethPoolBalanceDelta");

        const expectedBdxBack_d18 = toRecollatInEur_d18.mul(1e12).div(bdxInEurPrice_d12).mul(10075).div(10000); // +0.75% reward
        const expectedBdxBack = d18_ToNumber(expectedBdxBack_d18);
        
        const actualBdxReward = d18_ToNumber(bdxBalanceAfterRecolat_d18.sub(bdxBalanceBeforeRecolat_d18));
        console.log(`Actual BDX reward  : ${actualBdxReward}`);
        console.log(`Expected BDX reward: ${expectedBdxBack}`);
        expect(actualBdxReward).to.be.closeTo(expectedBdxBack, 0.001, "invalid actualBdxReward");

        const wethUserBalanceAfterRecolat_d18 = await weth.balanceOf(testUser.address);
        const actualWethCost_d18 = wethUserBalanceBeforeRecolat_d18.sub(wethUserBalanceAfterRecolat_d18);
        const diffPctWethBalance = diffPct(actualWethCost_d18, toRecollatInEth_d18);
        console.log(`Diff Weth balance: ${diffPctWethBalance}%`);
        expect(diffPctWethBalance).to.be.closeTo(0, 0.001, "invalid diffPctWethBalance");

        const expecedBdEuBdx = d18_ToNumber(bdEuBdxBalanceBeforeRecolat_d18.sub(expectedBdxBack_d18));
        const bdEuBdxBalanceAfterRecolat = d18_ToNumber(await bdx.balanceOf(bdEu.address));

        expect(bdEuBdxBalanceAfterRecolat).to.be.closeTo(expecedBdEuBdx, 0.001, "invalid bdEu bdx balance");
    });

    it("recollateralize should NOT fail when efCR < CR", async () => {        
        await setUpFunctionalSystem(hre, 0.3); // ~efCR
        const testUser = await getUser(hre);
        const weth = await getWeth(hre);

        await lockBdEuCrAt(hre, 0.9); // CR

        await weth.connect(testUser).deposit({value: to_d18(100)  });

        const bdEuWethPool = await getBdEuWethPool(hre);

        const toRecollatInEth_d18 = to_d18(0.001);
        await weth.connect(testUser).approve(bdEuWethPool.address, toRecollatInEth_d18); 
        await bdEuWethPool.connect(testUser).recollateralizeBdStable(toRecollatInEth_d18, 1);
    })

    it("recollateralize should fail when efCR > CR", async () => {        
        await setUpFunctionalSystem(hre, 0.9); // ~efCR

        await lockBdEuCrAt(hre, 0.3); // CR

        const testUser = await getUser(hre);
        const weth = await getWeth(hre);
        const bdEuWethPool = await getBdEuWethPool(hre);

        const toRecollatInEth_d18 = to_d18(0.001);
        await weth.connect(testUser).approve(bdEuWethPool.address, toRecollatInEth_d18); 

        await expect((async () => {
            await bdEuWethPool.connect(testUser).recollateralizeBdStable(toRecollatInEth_d18, 1);
        })()).to.be.rejectedWith("subtraction overflow");
    })
})
