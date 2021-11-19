import { SignerWithAddress } from "hardhat-deploy-ethers/dist/src/signers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { BDStable } from "../../typechain/BDStable";
import { d18_ToNumber, to_d18, to_d8 } from "../../utils/Helpers";
import * as constants from '../../utils/Constants';
import { WETH } from "../../typechain/WETH";
import { UniswapV2Router02 } from "../../typechain/UniswapV2Router02";
import { ERC20 } from "../../typechain/ERC20";
import { bigNumberToDecimal } from "../../utils/Helpers";
import { getWethPair } from "../../utils/Swaps";
import { getDeployer, getUniswapRouter, getWeth } from "./common";
import { UniswapV2Router02__factory } from "../../typechain/factories/UniswapV2Router02__factory";
import { BigNumber } from "ethers";
import { IERC20 } from "../../typechain/IERC20";

export async function updateWethPair(hre: HardhatRuntimeEnvironment, tokenName: string){
  var pair = await getWethPair(hre, tokenName);

  // await pair.updateOracle(); //todo ag
}

export async function swapWethFor(hre: HardhatRuntimeEnvironment, bdStableName: string, wEthToSwap: number) {
  const bdStable = await hre.ethers.getContract(bdStableName) as BDStable;

  const testUser = await hre.ethers.getNamedSigner('TEST2');

  const uniswapV2Router02 = await hre.ethers.getContract('UniswapV2Router02', testUser) as UniswapV2Router02;

  const currentBlock = await hre.ethers.provider.getBlock("latest");

  const weth = await hre.ethers.getContractAt("WETH", constants.wETH_address[hre.network.name], testUser.address) as WETH;
  await weth.deposit({ value: to_d18(100) });

  await weth.approve(uniswapV2Router02.address, to_d18(wEthToSwap));
  await uniswapV2Router02.swapExactTokensForTokens(
      to_d18(wEthToSwap),
      1,
      [constants.wETH_address[hre.network.name], bdStable.address],
      testUser.address,
      currentBlock.timestamp + 24*60*60*7);

  console.log("Swapped WETH for " + bdStableName);
}

export async function swapAsDeployer(
     hre: HardhatRuntimeEnvironment, 
     tokenInName: string,
     tokenOutName: string, 
     tokenInValue: number, 
     tokenOutMinValue: number)
  {
  const deployer = await getDeployer(hre);

  const tokenIn = await hre.ethers.getContract(tokenInName, deployer.address) as ERC20;
  const tokenOut = await hre.ethers.getContract(tokenOutName, deployer.address) as ERC20;

  await swapAsDeployerByContract(hre, tokenIn, tokenOut, tokenInValue, tokenOutMinValue);

  console.log(`Swapped ${tokenInName} for ${tokenOutName}`);
}

export async function swapWethAsDeployer(
  hre: HardhatRuntimeEnvironment, 
  tokenOutName: string, 
  wethInValue: number, 
  tokenMinOutValue: number)
{
  const deployer = await getDeployer(hre);

  const tokenIn = await getWeth(hre);
  const tokenOut = await hre.ethers.getContract(tokenOutName, deployer.address) as ERC20;

  await swapAsDeployerByContract(hre, tokenIn, tokenOut, wethInValue, tokenMinOutValue);

  console.log(`Swapped WETH for ${tokenOutName}`);
}

export async function swapForWethAsDeployer(
  hre: HardhatRuntimeEnvironment, 
  tokenInName: string, 
  tokenInValue: number, 
  wethMinOutValue: number)
{
  const deployer = await getDeployer(hre);

  const tokenIn = await hre.ethers.getContract(tokenInName, deployer.address) as ERC20;
  const tokenOut = await getWeth(hre);

  await swapAsDeployerByContract(hre, tokenIn, tokenOut, tokenInValue, wethMinOutValue);

  console.log(`Swapped ${tokenInName} for WETH`);
}

export async function swapAsDeployerByContract(
  hre: HardhatRuntimeEnvironment, 
  tokenIn: IERC20,
  tokenOut: IERC20, 
  tokenInValue: number, 
  tokenOutMinValue: number)
{
  const deployer = await getDeployer(hre);

  const uniswapV2Router02 = await getUniswapRouter(hre);

  const currentBlock = await hre.ethers.provider.getBlock("latest");

  await tokenIn.approve(uniswapV2Router02.address, to_d18(tokenInValue));
  await uniswapV2Router02.swapExactTokensForTokens(
    to_d18(tokenInValue),
    to_d18(tokenOutMinValue),
    [tokenIn.address, tokenOut.address],
    deployer.address,
    currentBlock.timestamp + 24*60*60*7);
}

export async function getPrices(hre: HardhatRuntimeEnvironment,bdStableName: string) {
  const bdStable = await hre.ethers.getContract(bdStableName) as BDStable;

  const testUser = await hre.ethers.getNamedSigner('TEST2');

  const uniswapV2Router02 = await hre.ethers.getContract('UniswapV2Router02', testUser) as UniswapV2Router02;

  //todo ag
  // const wethInBdStablePrice = await uniswapV2Router02.consult(constants.wETH_address[hre.network.name], to_d18(1), bdStable.address);
  // const bdStableWethPrice = await uniswapV2Router02.consult(bdStable.address, to_d18(1), constants.wETH_address[hre.network.name]);

  // const wethInBdStablePriceDecimal = bigNumberToDecimal(wethInBdStablePrice, 18);
  // const bdStableInWethPriceDecimal = bigNumberToDecimal(bdStableWethPrice, 18);

  // console.log(`WETH in ${bdStableName} price: ` + wethInBdStablePriceDecimal);
  // console.log(`${bdStableName} in WETH price: ` + bdStableInWethPriceDecimal);

  // return [wethInBdStablePriceDecimal, bdStableInWethPriceDecimal];

  return [0,0];
}

export async function provideLiquidity(
  hre: HardhatRuntimeEnvironment,
  user: SignerWithAddress,
  tokenA: ERC20 | WETH,
  tokenB: ERC20 | WETH,
  amountA: BigNumber,
  amountB: BigNumber
){
  const router = await getUniswapRouter(hre);

  // add liquidity to the uniswap pool (weth-bdeu)
  // receive LP tokens
  await tokenA.connect(user).approve(router.address, amountA);
  await tokenB.connect(user).approve(router.address, amountB);

  const currentBlock = await hre.ethers.provider.getBlock("latest");

  // router routes to the proper pair
  await (await router.connect(user).addLiquidity(
    tokenA.address, 
    tokenB.address, 
    amountA, 
    amountB,
    1, 
    1, 
    user.address, 
    currentBlock.timestamp + 600)).wait();
}

export async function swapEthForWbtc(hre: HardhatRuntimeEnvironment, account: SignerWithAddress, amountETH: BigNumber){
  // swaps ETH for WETH internally
  
  const uniRouter = UniswapV2Router02__factory.connect(constants.uniswapRouterAddress, account);
  await uniRouter.connect(account).swapExactETHForTokens(0, [constants.wETH_address[hre.network.name], constants.wBTC_address[hre.network.name]], account.address,  Date.now() + 3600, {
    value: amountETH
  });
}