import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber } from 'ethers'
import { ethers } from 'hardhat'
import { DummyComposableERC721, DummyERC20, DummyERC721 } from '../typechain-types'
import { Rentals } from '../typechain-types/Rentals'
import {
  ether,
  getOwnerRentSignature,
  getRandomBytes,
  getUserRentSignature,
  now,
} from './utils/rentals'

describe('Rentals', () => {
  let deployer: SignerWithAddress
  let contractOwner: SignerWithAddress
  let user: SignerWithAddress
  let assetOwner: SignerWithAddress
  let rentals: Rentals
  let erc721: DummyERC721
  let composableErc721: DummyComposableERC721
  let erc20: DummyERC20

  beforeEach(async () => {
    // Store addresses
    ;[deployer, contractOwner, user, assetOwner] = await ethers.getSigners()

    // Deploy Rentals contract
    const RentalsFactory = await ethers.getContractFactory('Rentals')
    rentals = await RentalsFactory.connect(deployer).deploy()

    // Deploy ERC721
    const ERC721Factory = await ethers.getContractFactory('DummyERC721')
    erc721 = await ERC721Factory.connect(deployer).deploy()

    // Deploy ComposableERC721
    const ComposableERC721Factory = await ethers.getContractFactory('DummyComposableERC721')
    composableErc721 = await ComposableERC721Factory.connect(deployer).deploy()

    // Deploy ERC20
    const ERC20Factory = await ethers.getContractFactory('DummyERC20')
    erc20 = await ERC20Factory.connect(deployer).deploy()
  })

  describe('initialize', () => {
    beforeEach(async () => {
      await rentals.connect(deployer).initialize(contractOwner.address, erc20.address)
    })

    it('should set the owner', async () => {
      expect(await rentals.owner()).to.be.equal(contractOwner.address)
    })

    it('should set the erc20 token', async () => {
      expect(await rentals.erc20Token()).to.be.equal(erc20.address)
    })

    it('should revert when initialized more than once', async () => {
      await expect(rentals.connect(deployer).initialize(contractOwner.address, erc20.address)).to.be.revertedWith(
        'Initializable: contract is already initialized'
      )
    })
  })

  describe('setERC20Token', () => {
    beforeEach(async () => {
      await rentals.connect(deployer).initialize(contractOwner.address, deployer.address)
    })

    it('should update the erc20 token variable', async () => {
      await rentals.connect(contractOwner).setERC20Token(erc20.address)
      expect(await rentals.erc20Token()).to.be.equal(erc20.address)
    })

    it('should revert when sender is not owner', async () => {
      await expect(rentals.connect(user).setERC20Token(erc20.address)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )
    })
  })

  describe('bumpContractNonce', () => {
    beforeEach(async () => {
      await rentals.connect(deployer).initialize(contractOwner.address, deployer.address)
    })

    it('should increase the contractNonce by 1', async () => {
      expect(await rentals.connect(contractOwner).contractNonce()).to.equal(0)
      await rentals.connect(contractOwner).bumpContractNonce()
      expect(await rentals.connect(contractOwner).contractNonce()).to.equal(1)
    })

    it('should revert when the contract owner is not the caller', async () => {
      await expect(rentals.connect(user).bumpContractNonce()).to.be.revertedWith('Ownable: caller is not the owner')
    })
  })

  describe('rent', () => {
    let ownerParams: Omit<Rentals.OwnerRentParamsStruct, 'signature'>
    let userParams: Omit<Rentals.UserRentParamsStruct, 'signature'>

    beforeEach(async () => {
      ownerParams = {
        owner: assetOwner.address,
        contractAddress: erc721.address,
        tokenId: 100,
        fingerprint: [],
        maxDays: 20,
        minDays: 10,
        pricePerDay: ether('100'),
        expiration: now() + 1000,
        contractNonce: 0,
      }

      userParams = {
        user: user.address,
        contractAddress: erc721.address,
        tokenId: 100,
        fingerprint: [],
        _days: 15,
        pricePerDay: ether('100'),
        expiration: now() + 1000,
        contractNonce: 0,
      }

      await rentals.connect(deployer).initialize(contractOwner.address, deployer.address)
    })

    it('should revert when the owner signer does not match the owner in params', async () => {
      await expect(
        rentals.connect(assetOwner).rent(
          {
            ...ownerParams,
            signature: await getOwnerRentSignature(assetOwner, rentals, {
              ...ownerParams,
              owner: user.address,
            }),
          },
          {
            ...userParams,
            signature: await getUserRentSignature(user, rentals, userParams),
          }
        )
      ).to.be.revertedWith('Rentals#_validateOwnerRentSigner: INVALID_OWNER_RENT_SIGNATURE')
    })

    it('should revert when the user signer does not match the user provided in params', async () => {
      await expect(
        rentals.connect(assetOwner).rent(
          {
            ...ownerParams,
            signature: await getOwnerRentSignature(assetOwner, rentals, ownerParams),
          },
          {
            ...userParams,
            signature: await getUserRentSignature(user, rentals, { ...userParams, user: assetOwner.address }),
          }
        )
      ).to.be.revertedWith('Rentals#_validateUserRentSigner: INVALID_USER_RENT_SIGNATURE')
    })

    it('should revert when the block timestamp is higher than the provided owner signature expiration', async () => {
      ownerParams = { ...ownerParams, expiration: now() - 1000 }

      await expect(
        rentals.connect(assetOwner).rent(
          {
            ...ownerParams,
            signature: await getOwnerRentSignature(assetOwner, rentals, ownerParams),
          },
          {
            ...userParams,
            signature: await getUserRentSignature(user, rentals, userParams),
          }
        )
      ).to.be.revertedWith('Rentals#rent: EXPIRED_OWNER_SIGNATURE')
    })

    it('should revert when the block timestamp is higher than the provided user signature expiration', async () => {
      userParams = { ...userParams, expiration: now() - 1000 }

      await expect(
        rentals.connect(assetOwner).rent(
          {
            ...ownerParams,
            signature: await getOwnerRentSignature(assetOwner, rentals, ownerParams),
          },
          {
            ...userParams,
            signature: await getUserRentSignature(user, rentals, userParams),
          }
        )
      ).to.be.revertedWith('Rentals#rent: EXPIRED_USER_SIGNATURE')
    })

    it('should revert when max days is lower than min days', async () => {
      ownerParams = { ...ownerParams, minDays: BigNumber.from(ownerParams.maxDays).add(1) }

      await expect(
        rentals.connect(assetOwner).rent(
          {
            ...ownerParams,
            signature: await getOwnerRentSignature(assetOwner, rentals, ownerParams),
          },
          {
            ...userParams,
            signature: await getUserRentSignature(user, rentals, userParams),
          }
        )
      ).to.be.revertedWith('Rentals#rent: MAX_DAYS_NOT_GE_THAN_MIN_DAYS')
    })

    it('should revert when user days is lower than owner min days', async () => {
      userParams = { ...userParams, _days: BigNumber.from(ownerParams.minDays).sub(1) }

      await expect(
        rentals.connect(assetOwner).rent(
          {
            ...ownerParams,
            signature: await getOwnerRentSignature(assetOwner, rentals, ownerParams),
          },
          {
            ...userParams,
            signature: await getUserRentSignature(user, rentals, userParams),
          }
        )
      ).to.be.revertedWith('Rentals#rent: DAYS_NOT_IN_RANGE')
    })

    it('should revert when user days is higher than owner max days', async () => {
      userParams = { ...userParams, _days: BigNumber.from(ownerParams.maxDays).add(1) }

      await expect(
        rentals.connect(assetOwner).rent(
          {
            ...ownerParams,
            signature: await getOwnerRentSignature(assetOwner, rentals, ownerParams),
          },
          {
            ...userParams,
            signature: await getUserRentSignature(user, rentals, userParams),
          }
        )
      ).to.be.revertedWith('Rentals#rent: DAYS_NOT_IN_RANGE')
    })

    it('should revert when owner and user provide different price per day', async () => {
      userParams = { ...userParams, pricePerDay: BigNumber.from(ownerParams.pricePerDay).add(1) }

      await expect(
        rentals.connect(assetOwner).rent(
          {
            ...ownerParams,
            signature: await getOwnerRentSignature(assetOwner, rentals, ownerParams),
          },
          {
            ...userParams,
            signature: await getUserRentSignature(user, rentals, userParams),
          }
        )
      ).to.be.revertedWith('Rentals#rent: DIFFERENT_PRICE')
    })

    it('should revert when owner and user provide different contract addresses', async () => {
      userParams = { ...userParams, contractAddress: assetOwner.address }

      await expect(
        rentals.connect(assetOwner).rent(
          {
            ...ownerParams,
            signature: await getOwnerRentSignature(assetOwner, rentals, ownerParams),
          },
          {
            ...userParams,
            signature: await getUserRentSignature(user, rentals, userParams),
          }
        )
      ).to.be.revertedWith('Rentals#rent: DIFFERENT_CONTRACT_ADDRESS')
    })

    it('should revert when owner and user provide different token ids', async () => {
      userParams = { ...userParams, tokenId: 200 }

      await expect(
        rentals.connect(assetOwner).rent(
          {
            ...ownerParams,
            signature: await getOwnerRentSignature(assetOwner, rentals, ownerParams),
          },
          {
            ...userParams,
            signature: await getUserRentSignature(user, rentals, userParams),
          }
        )
      ).to.be.revertedWith('Rentals#rent: DIFFERENT_TOKEN_ID')
    })

    it('should revert when owner and user provide different fingerprints', async () => {
      userParams = { ...userParams, fingerprint: getRandomBytes() }

      await expect(
        rentals.connect(assetOwner).rent(
          {
            ...ownerParams,
            signature: await getOwnerRentSignature(assetOwner, rentals, ownerParams),
          },
          {
            ...userParams,
            signature: await getUserRentSignature(user, rentals, userParams),
          }
        )
      ).to.be.revertedWith('Rentals#rent: DIFFERENT_FINGERPRINT')
    })

    it('should revert when owner contract nonce is not the same as the contract', async () => {
      ownerParams = { ...ownerParams, contractNonce: 1 }

      await expect(
        rentals.connect(assetOwner).rent(
          {
            ...ownerParams,
            signature: await getOwnerRentSignature(assetOwner, rentals, ownerParams),
          },
          {
            ...userParams,
            signature: await getUserRentSignature(user, rentals, userParams),
          }
        )
      ).to.be.revertedWith('Rentals#rent: INVALID_OWNER_CONTRACT_NONCE')
    })

    it('should revert when user contract nonce is not the same as the contract', async () => {
      userParams = { ...userParams, contractNonce: 1 }

      await expect(
        rentals.connect(assetOwner).rent(
          {
            ...ownerParams,
            signature: await getOwnerRentSignature(assetOwner, rentals, ownerParams),
          },
          {
            ...userParams,
            signature: await getUserRentSignature(user, rentals, userParams),
          }
        )
      ).to.be.revertedWith('Rentals#rent: INVALID_USER_CONTRACT_NONCE')
    })

    it('should revert when the provided contract address is not for a contract', async () => {
      ownerParams = { ...ownerParams, contractAddress: assetOwner.address }
      userParams = { ...userParams, contractAddress: ownerParams.contractAddress }

      await expect(
        rentals.connect(assetOwner).rent(
          {
            ...ownerParams,
            signature: await getOwnerRentSignature(assetOwner, rentals, ownerParams),
          },
          {
            ...userParams,
            signature: await getUserRentSignature(user, rentals, userParams),
          }
        )
      ).to.be.revertedWith('Require#isERC721: ADDRESS_NOT_A_CONTRACT')
    })

    it('should revert when the provided contract address does not implement `supportsInterface`', async () => {
      ownerParams = { ...ownerParams, contractAddress: erc20.address }
      userParams = { ...userParams, contractAddress: ownerParams.contractAddress }

      await expect(
        rentals.connect(assetOwner).rent(
          {
            ...ownerParams,
            signature: await getOwnerRentSignature(assetOwner, rentals, ownerParams),
          },
          {
            ...userParams,
            signature: await getUserRentSignature(user, rentals, userParams),
          }
        )
      ).to.be.revertedWith(
        "Transaction reverted: function selector was not recognized and there's no fallback function"
      )
    })

    it("should revert when the provided contract address's `supportsInterface` returns false", async () => {
      const DummyFalseSupportsInterfaceFactory = await ethers.getContractFactory('DummyFalseSupportsInterface')
      const falseSupportsInterface = await DummyFalseSupportsInterfaceFactory.connect(deployer).deploy()

      ownerParams = { ...ownerParams, contractAddress: falseSupportsInterface.address }
      userParams = { ...userParams, contractAddress: ownerParams.contractAddress }

      await expect(
        rentals.connect(assetOwner).rent(
          {
            ...ownerParams,
            signature: await getOwnerRentSignature(assetOwner, rentals, ownerParams),
          },
          {
            ...userParams,
            signature: await getUserRentSignature(user, rentals, userParams),
          }
        )
      ).to.be.revertedWith('Require#isERC721: ADDRESS_NOT_AN_ERC721')
    })

    it("should revert when the provided contract address's `verifyFingerprint` returns false", async () => {
      const DummyFalseVerifyFingerprintFactory = await ethers.getContractFactory('DummyFalseVerifyFingerprint')
      const falseVerifyFingerprint = await DummyFalseVerifyFingerprintFactory.connect(deployer).deploy()

      ownerParams = {
        ...ownerParams,
        contractAddress: falseVerifyFingerprint.address,
        fingerprint: getRandomBytes(),
      }

      userParams = {
        ...userParams,
        contractAddress: ownerParams.contractAddress,
        fingerprint: ownerParams.fingerprint,
      }

      await expect(
        rentals.connect(assetOwner).rent(
          {
            ...ownerParams,
            signature: await getOwnerRentSignature(assetOwner, rentals, ownerParams),
          },
          {
            ...userParams,
            signature: await getUserRentSignature(user, rentals, userParams),
          }
        )
      ).to.be.revertedWith('Require#isComposableERC721: INVALID_FINGERPRINT')
    })

    it("should NOT revert when an empty fingerprint is provided and the provided contract address's `verifyFingerprint` returns false", async () => {
      const DummyFalseVerifyFingerprintFactory = await ethers.getContractFactory('DummyFalseVerifyFingerprint')
      const falseVerifyFingerprint = await DummyFalseVerifyFingerprintFactory.connect(deployer).deploy()

      ownerParams = {
        ...ownerParams,
        contractAddress: falseVerifyFingerprint.address,
      }

      userParams = {
        ...userParams,
        contractAddress: ownerParams.contractAddress,
      }

      await rentals.connect(assetOwner).rent(
        {
          ...ownerParams,
          signature: await getOwnerRentSignature(assetOwner, rentals, ownerParams),
        },
        {
          ...userParams,
          signature: await getUserRentSignature(user, rentals, userParams),
        }
      )
    })
  })
})
