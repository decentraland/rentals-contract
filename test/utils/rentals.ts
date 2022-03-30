import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { ethers } from 'hardhat'
import { Rentals } from '../../typechain-types'

export const getRandomSignature = () => ethers.utils.randomBytes(65)

export const getRandomSalt = () => ethers.utils.randomBytes(32)

export const getRandomBytes = () => getRandomSalt()

export const ether = (amount: string) => ethers.utils.parseUnits(amount, 'ether')

export const now = () => Math.trunc(Date.now() / 1000)

export const getOwnerRentSignature = (
  signer: SignerWithAddress,
  contract: Rentals,
  params: Omit<Rentals.OwnerRentParamsStruct, 'signature'>
): Promise<string> =>
  signer._signTypedData(
    {
      chainId: 31337,
      name: 'Rentals',
      verifyingContract: contract.address,
      version: '1',
    },
    {
      OwnerRent: [
        {
          type: 'address',
          name: 'owner',
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
          name: 'maxDays',
        },
        {
          type: 'uint256',
          name: 'minDays',
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
          name: 'rentalNonce',
        },
      ],
    },
    params
  )

export const getUserRentSignature = (
  signer: SignerWithAddress,
  contract: Rentals,
  params: Omit<Rentals.UserRentParamsStruct, 'signature'>
): Promise<string> =>
  signer._signTypedData(
    {
      chainId: 31337,
      name: 'Rentals',
      verifyingContract: contract.address,
      version: '1',
    },
    {
      UserRent: [
        {
          type: 'address',
          name: 'user',
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
          name: '_days',
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
          name: 'rentalNonce',
        },
        {
          type: 'uint256',
          name: 'offerNonce',
        },
      ],
    },
    params
  )
