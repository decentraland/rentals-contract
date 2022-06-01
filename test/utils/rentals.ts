import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { BigNumber, BigNumberish } from 'ethers'
import { ethers } from 'hardhat'
import { Rentals } from '../../typechain-types'

export const getRandomSignature = () => ethers.utils.randomBytes(65)

export const getRandomBytes32 = () => ethers.utils.randomBytes(32)

export const getZeroBytes32 = () => getRandomBytes32().map(() => 0)

export const ether = (amount: string) => ethers.utils.parseUnits(amount, 'ether')

export const now = () => Math.trunc(Date.now() / 1000)

export const daysToSeconds = (days: BigNumberish) => BigNumber.from(days).mul(86400).toNumber()

export const getLessorSignature = (signer: SignerWithAddress, contract: Rentals, params: Omit<Rentals.LessorStruct, 'signature'>): Promise<string> =>
  signer._signTypedData(
    {
      chainId: 31337,
      name: 'Rentals',
      verifyingContract: contract.address,
      version: '1',
    },
    {
      Lessor: [
        {
          type: 'address',
          name: 'signer',
        },
        {
          type: 'address',
          name: 'contractAddress',
        },
        {
          type: 'uint256',
          name: 'tokenId',
        },
        {
          type: 'bytes32',
          name: 'fingerprint',
        },
        {
          type: 'uint256',
          name: 'expiration',
        },
        {
          type: 'uint256[3]',
          name: 'nonces',
        },
        {
          type: 'uint256[]',
          name: 'pricePerDay',
        },
        {
          type: 'uint256[]',
          name: 'maxDays',
        },
        {
          type: 'uint256[]',
          name: 'minDays',
        },
      ],
    },
    params
  )

export const getTenantSignature = (signer: SignerWithAddress, contract: Rentals, params: Omit<Rentals.TenantStruct, 'signature'>): Promise<string> =>
  signer._signTypedData(
    {
      chainId: 31337,
      name: 'Rentals',
      verifyingContract: contract.address,
      version: '1',
    },
    {
      Tenant: [
        {
          type: 'address',
          name: 'signer',
        },
        {
          type: 'address',
          name: 'contractAddress',
        },
        {
          type: 'uint256',
          name: 'tokenId',
        },
        {
          type: 'bytes32',
          name: 'fingerprint',
        },
        {
          type: 'uint256',
          name: 'expiration',
        },
        {
          type: 'uint256[3]',
          name: 'nonces',
        },
        {
          type: 'uint256',
          name: 'pricePerDay',
        },
        {
          type: 'uint256',
          name: 'rentalDays',
        },
        {
          type: 'address',
          name: 'operator',
        },
        {
          type: 'uint256',
          name: 'index',
        },
      ],
    },
    params
  )

export const getMetaTxSignature = async (signer: SignerWithAddress, contract: Rentals, functionSignature: string): Promise<string> => {
  const params = {
    nonce: await contract.getNonce(signer.address),
    from: signer.address,
    functionSignature,
  }

  return signer._signTypedData(
    {
      chainId: 31337,
      name: 'Rentals',
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
          name: 'functionSignature',
        },
      ],
    },
    params
  )
}
