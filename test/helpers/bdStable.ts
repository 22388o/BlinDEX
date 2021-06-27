import { HardhatRuntimeEnvironment } from "hardhat/types";
import { simulateTimeElapseInSeconds, to_d18, d18_ToNumber } from "../../utils/Helpers"
import { getBdEur, getBdx } from "./common"
import { updateWethPair } from "./swaps";

const oneHour = 60*60;

export async function updateBdxOracleRefreshRatiosBdEur(hre: HardhatRuntimeEnvironment){
  await simulateTimeElapseInSeconds(oneHour*2);

  await updateWethPair(hre, "BDEUR");

  const bdEur = await getBdEur(hre);
  await bdEur.refreshCollateralRatio();
}

export async function updateBdxOracle(hre: HardhatRuntimeEnvironment){
  await simulateTimeElapseInSeconds(oneHour*2);

  await updateWethPair(hre, "BDXShares");
}