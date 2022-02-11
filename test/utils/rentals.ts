import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { ethers } from 'hardhat'
import { Rentals } from '../../typechain-types'

export const getRandomSignature = () => ethers.utils.randomBytes(65)

export const getRandomSalt = () => ethers.utils.randomBytes(32)

export const getRenterSignature = (
  renter: SignerWithAddress,
  rentals: Rentals,
  params: Omit<Rentals.RenterParamsStruct, 'sig'>
) =>
  renter._signTypedData(
    {
      chainId: 31337,
      name: 'Rentals',
      verifyingContract: rentals.address,
      version: '1',
    },
    {
      RenterSignData: [
        {
          type: 'address',
          name: 'renter',
        },
        {
          type: 'uint256',
          name: 'maxDays',
        },
        {
          type: 'uint256',
          name: 'price',
        },
        {
          type: 'uint256',
          name: 'expiration',
        },
        {
          type: 'address',
          name: '_contract',
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
          type: 'bytes32',
          name: 'salt',
        },
      ],
    },
    params
  )
