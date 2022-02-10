import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { Rentals } from '../../typechain-types'

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
          name: 'salt',
        },
      ],
    },
    params
  )

export const getTenantSignature = (
  tenant: SignerWithAddress,
  rentals: Rentals,
  params: Omit<Rentals.TenantParamsStruct, 'sig'>
) =>
  tenant._signTypedData(
    {
      chainId: 31337,
      name: 'Rentals',
      verifyingContract: rentals.address,
      version: '1',
    },
    {
      TenantSignData: [
        {
          type: 'address',
          name: 'tenant',
        },
        {
          type: 'uint256',
          name: '_days',
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
          name: 'salt',
        },
      ],
    },
    params
  )
