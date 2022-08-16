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

//@ts-ignore
export const evmIncreaseTime = (seconds: number) => network.provider.send('evm_increaseTime', [seconds])

//@ts-ignore
export const evmMine = () => network.provider.send('evm_mine')

export const getLatestBlockTimestamp = async () => (await ethers.provider.getBlock('latest')).timestamp

export const getPendingBlockTimestamp = async () => {
  //@ts-ignore
  const pendingBlock = await network.provider.send('eth_getBlockByNumber', ['pending', false])
  return Number(pendingBlock.timestamp)
}

export const getListingSignature = (
  signer: SignerWithAddress,
  contract: Rentals,
  params: Omit<Rentals.ListingStruct, 'signature'>
): Promise<string> =>
  signer._signTypedData(
    {
      chainId: 31337,
      name: 'Rentals',
      verifyingContract: contract.address,
      version: '1',
    },
    {
      Listing: [
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
          type: 'address',
          name: 'paymentErc20',
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
        {
          type: 'address',
          name: 'target',
        },
      ],
    },
    params
  )

export const getOfferSignature = (signer: SignerWithAddress, contract: Rentals, params: Omit<Rentals.OfferStruct, 'signature'>): Promise<string> =>
  signer._signTypedData(
    {
      chainId: 31337,
      name: 'Rentals',
      verifyingContract: contract.address,
      version: '1',
    },
    {
      Offer: [
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
          type: 'address',
          name: 'paymentErc20',
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
          type: 'bytes32',
          name: 'fingerprint',
        },
      ],
    },
    params
  )

export const getMetaTxSignature = async (signer: SignerWithAddress, contract: Rentals, functionData: string): Promise<string> => {
  const params = {
    nonce: await contract.getNonce(signer.address),
    from: signer.address,
    functionData,
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
          name: 'functionData',
        },
      ],
    },
    params
  )
}

export const acceptListingABI = [
  {
    inputs: [
      {
        components: [
          {
            internalType: 'address',
            name: 'signer',
            type: 'address',
          },
          {
            internalType: 'address',
            name: 'contractAddress',
            type: 'address',
          },
          {
            internalType: 'uint256',
            name: 'tokenId',
            type: 'uint256',
          },
          {
            internalType: 'address',
            name: 'paymentErc20',
            type: 'address',
          },
          {
            internalType: 'uint256',
            name: 'expiration',
            type: 'uint256',
          },
          {
            internalType: 'uint256[3]',
            name: 'nonces',
            type: 'uint256[3]',
          },
          {
            internalType: 'uint256[]',
            name: 'pricePerDay',
            type: 'uint256[]',
          },
          {
            internalType: 'uint256[]',
            name: 'maxDays',
            type: 'uint256[]',
          },
          {
            internalType: 'uint256[]',
            name: 'minDays',
            type: 'uint256[]',
          },
          {
            internalType: 'address',
            name: 'target',
            type: 'address',
          },
          {
            internalType: 'bytes',
            name: 'signature',
            type: 'bytes',
          },
        ],
        internalType: 'struct Rentals.Listing',
        name: '_listing',
        type: 'tuple',
      },
      {
        internalType: 'address',
        name: '_operator',
        type: 'address',
      },
      {
        internalType: 'uint256',
        name: '_index',
        type: 'uint256',
      },
      {
        internalType: 'uint256',
        name: '_rentalDays',
        type: 'uint256',
      },
      {
        internalType: 'bytes32',
        name: '_fingerprint',
        type: 'bytes32',
      },
    ],
    name: 'acceptListing',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
]

export const acceptOfferABI = [
  {
    inputs: [
      {
        components: [
          {
            internalType: 'address',
            name: 'signer',
            type: 'address',
          },
          {
            internalType: 'address',
            name: 'contractAddress',
            type: 'address',
          },
          {
            internalType: 'uint256',
            name: 'tokenId',
            type: 'uint256',
          },
          {
            internalType: 'address',
            name: 'paymentErc20',
            type: 'address',
          },
          {
            internalType: 'uint256',
            name: 'expiration',
            type: 'uint256',
          },
          {
            internalType: 'uint256[3]',
            name: 'nonces',
            type: 'uint256[3]',
          },
          {
            internalType: 'uint256',
            name: 'pricePerDay',
            type: 'uint256',
          },
          {
            internalType: 'uint256',
            name: 'rentalDays',
            type: 'uint256',
          },
          {
            internalType: 'address',
            name: 'operator',
            type: 'address',
          },
          {
            internalType: 'bytes32',
            name: 'fingerprint',
            type: 'bytes32',
          },
          {
            internalType: 'bytes',
            name: 'signature',
            type: 'bytes',
          },
        ],
        internalType: 'struct Rentals.Offer',
        name: '_offer',
        type: 'tuple',
      },
    ],
    name: 'acceptOffer',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
]
