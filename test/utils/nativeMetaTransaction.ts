import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { ethers } from 'hardhat'
import { DummyNativeMetaTransactionImplementator } from '../../typechain-types'

type InterfaceType = typeof ethers.utils.Interface
type ABI = ConstructorParameters<InterfaceType>[0]
type EncodeFunctionDataParams = Parameters<InterfaceType['prototype']['encodeFunctionData']>
type FunctionFragment = EncodeFunctionDataParams[0]
type Values = EncodeFunctionDataParams[1]

export const getMetaTxFunctionData = (abi: ABI, functionFragment: FunctionFragment, values?: Values): string =>
  new ethers.utils.Interface(abi).encodeFunctionData(functionFragment, values)

export const getMetaTxSignature = async (
  signer: SignerWithAddress,
  contract: DummyNativeMetaTransactionImplementator,
  functionData: string
): Promise<string> => {
  const params = {
    nonce: await contract.nonces(signer.address),
    from: signer.address,
    functionData,
  }

  return signer._signTypedData(
    {
      chainId: 31337,
      name: 'DummyNativeMetaTransactionImplementator',
      verifyingContract: contract.address,
      version: '1',
    },
    {
      MetaTransaction: [
        {
          type: 'uint256',
          name: 'nonce',
        },
        {
          type: 'address',
          name: 'from',
        },
        {
          type: 'bytes',
          name: 'functionData',
        },
      ],
    },
    params
  )
}
