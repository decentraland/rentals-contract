import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { BigNumber, BigNumberish } from 'ethers'
import { ethers } from 'hardhat'
import { Rentals } from '../../typechain-types'

export const getRandomSignature = () => ethers.utils.randomBytes(65)

export const getRandomSalt = () => ethers.utils.randomBytes(32)

export const getRandomBytes = () => getRandomSalt()

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
          type: 'bytes',
          name: 'fingerprint',
        },
        {
          type: 'uint256',
          name: 'pricePerDay',
        },
        {
          type: 'uint256',
          name: 'expiration',
        },
        {
          type: 'uint256',
          name: 'contractNonce',
        },
        {
          type: 'uint256',
          name: 'signerNonce',
        },
        {
          type: 'uint256',
          name: 'assetNonce',
        },
        {
          type: 'uint256',
          name: 'maxDays',
        },
        {
          type: 'uint256',
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
          type: 'bytes',
          name: 'fingerprint',
        },
        {
          type: 'uint256',
          name: 'pricePerDay',
        },
        {
          type: 'uint256',
          name: 'expiration',
        },
        {
          type: 'uint256',
          name: 'contractNonce',
        },
        {
          type: 'uint256',
          name: 'signerNonce',
        },
        {
          type: 'uint256',
          name: 'assetNonce',
        },
        {
          type: 'uint256',
          name: 'rentalDays',
        },
        {
          type: 'address',
          name: 'operator',
        },
      ],
    },
    params
  )
