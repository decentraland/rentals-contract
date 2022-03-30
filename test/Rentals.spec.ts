import { Block } from '@ethersproject/abstract-provider'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, BigNumberish } from 'ethers'
import { ethers, network } from 'hardhat'
import { DummyComposableERC721, DummyERC20, DummyERC721 } from '../typechain-types'
import { Rentals } from '../typechain-types/Rentals'
import {
  ether,
  getOwnerRentSignature,
  getRandomBytes,
  getRandomSalt,
  getRandomSignature,
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
        rentalNonce: 0,
      }

      userParams = {
        user: user.address,
        contractAddress: erc721.address,
        tokenId: 100,
        fingerprint: [],
        _days: 15,
        pricePerDay: ether('100'),
        expiration: now() + 1000,
        rentalNonce: 0,
        offerNonce: 0,
      }

      await rentals.connect(deployer).initialize(contractOwner.address, deployer.address)
    })

    describe('when validating signers', () => {
      describe('when the owner signer does not match the owner provided in params', () => {
        it('should revert with error invalid owner rent siganture error', async () => {
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
      })

      describe('when the user signer does not match the user provided in params', () => {
        it('should revert with error invalid user rent siganture error', async () => {
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
      })
    })

    describe('when validating expiration', () => {
      describe('when the owner signature has expired', () => {
        it('should revert with expired owner signature error', async () => {
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
      })

      describe('when the user signature has expired', () => {
        it('should revert with expired user signature error', async () => {
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
      })
    })

    describe('when validating owner min and max days', () => {
      describe('when min days is higher than max days', () => {
        it('should revert with max days not greater or equal than min days', async () => {
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
      })
    })

    describe('when validating user provided days', () => {
      describe('when provided days is lower than owner min days', () => {
        it('should revert with not in range error', async () => {
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
      })

      describe('when provided days is higher than owner max days', () => {
        it('should revert with not in range error', async () => {
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
      })
    })

    describe('when validating the price per day', () => {
      describe('when the owner and the user provide different values', () => {
        it('should revert with a different price error', async () => {
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
      })
    })

    describe('when validating the provided asset', () => {
      describe('when the contract address is not a contract', () => {
        it('should revert with a is not a contract error', async () => {
          ownerParams = { ...ownerParams, contractAddress: assetOwner.address }

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
      })

      describe('when the contract address does not implement `supportsInterface` function', () => {
        it('should revert with a function selector not recognized error', async () => {
          ownerParams = { ...ownerParams, contractAddress: erc20.address }

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
      })

      describe("when the contract address's `supportsInterface` returns false", () => {
        it('should revert with not an ERC721 error', async () => {
          const DummyFalseSupportsInterfaceFactory = await ethers.getContractFactory('DummyFalseSupportsInterface')
          const falseSupportsInterface = await DummyFalseSupportsInterfaceFactory.connect(deployer).deploy()

          ownerParams = { ...ownerParams, contractAddress: falseSupportsInterface.address }

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
      })

      describe('when `verifyFingerprint` returns false on the provided ComposableERC721', () => {
        describe('when providing a fingerprint', () => {
          it('should revert with not an invalid fingerprint error', async () => {
            const DummyFalseVerifyFingerprintFactory = await ethers.getContractFactory('DummyFalseVerifyFingerprint')
            const falseVerifyFingerprint = await DummyFalseVerifyFingerprintFactory.connect(deployer).deploy()

            ownerParams = {
              ...ownerParams,
              contractAddress: falseVerifyFingerprint.address,
              fingerprint: getRandomBytes(),
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
        })

        describe('when the fingerprint is empty', () => {
          it('should not revert as the vaidation will not occur', async () => {
            const DummyFalseVerifyFingerprintFactory = await ethers.getContractFactory('DummyFalseVerifyFingerprint')
            const falseVerifyFingerprint = await DummyFalseVerifyFingerprintFactory.connect(deployer).deploy()

            ownerParams = {
              ...ownerParams,
              contractAddress: falseVerifyFingerprint.address,
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
    })

    // let renterParams: any
    // let days: number
    // let latestBlock: Block
    // let tokenId: BigNumberish
    // beforeEach(async () => {
    //   await rentals.connect(deployer).initialize(owner.address, erc20.address)
    //   days = 10
    //   tokenId = 1
    //   latestBlock = await ethers.provider.getBlock('latest')
    //   renterParams = {
    //     renter: renter.address,
    //     maxDays: days,
    //     price: ethers.utils.parseUnits('10', 'ether'),
    //     expiration: latestBlock.timestamp + 100,
    //     tokenAddress: erc721.address,
    //     tokenId: tokenId,
    //     fingerprint: tokenId,
    //     salt: getRandomSalt(),
    //   }
    // })
    // it('should add the renter signature to the isRejectedSignature mapping', async () => {
    //   const renterSignature = await getRenterSignature(renter, rentals, renterParams)
    //   renterParams = { ...renterParams, sig: renterSignature }
    //   // Mint and Approve ERC721
    //   await erc721.mint(renter.address, tokenId)
    //   await erc721.connect(renter).approve(rentals.address, tokenId)
    //   // Mint and Approve ERC20
    //   await erc20.mint(tenant.address, ethers.utils.parseUnits('100', 'ether'))
    //   await erc20.connect(tenant).approve(rentals.address, ethers.utils.parseUnits('100', 'ether'))
    //   // Rent
    //   await rentals.connect(tenant).rent(renterParams, days)
    //   // Check the signature was added to the mapping
    //   expect(await rentals.isSignatureRejected(renterSignature)).to.be.true
    // })
    // it('should transfer the erc721 token from the renter to the contract', async () => {
    //   const renterSignature = await getRenterSignature(renter, rentals, renterParams)
    //   renterParams = { ...renterParams, sig: renterSignature }
    //   // Mint and Approve ERC721
    //   await erc721.mint(renter.address, tokenId)
    //   await erc721.connect(renter).approve(rentals.address, tokenId)
    //   // Mint and Approve ERC20
    //   await erc20.mint(tenant.address, ether('100'))
    //   await erc20.connect(tenant).approve(rentals.address, ether('100'))
    //   // Check renter is the owner of the NFT
    //   expect(await erc721.ownerOf(tokenId)).to.be.equal(renter.address)
    //   // Rent
    //   await rentals.connect(tenant).rent(renterParams, days)
    //   // Check rentals contract is the onwer of the NFT
    //   expect(await erc721.ownerOf(tokenId)).to.be.equal(rentals.address)
    // })
    // it('should transfer the composabble erc721 token from the renter to the contract', async () => {
    //   // Mint and Approve ERC721
    //   await composableErc721.mint(renter.address, tokenId)
    //   await composableErc721.connect(renter).approve(rentals.address, tokenId)
    //   // Mint and Approve ERC20
    //   await erc20.mint(tenant.address, ether('100'))
    //   await erc20.connect(tenant).approve(rentals.address, ether('100'))
    //   // Signature
    //   const fingerprint = await composableErc721.getFingerprint(tokenId)
    //   renterParams = { ...renterParams, tokenAddress: composableErc721.address, fingerprint }
    //   const renterSignature = await getRenterSignature(renter, rentals, renterParams)
    //   renterParams = { ...renterParams, sig: renterSignature }
    //   // Check renter is the owner of the NFT
    //   expect(await composableErc721.ownerOf(tokenId)).to.be.equal(renter.address)
    //   // Rent
    //   await rentals.connect(tenant).rent(renterParams, days)
    //   // Check rentals contract is the onwer of the NFT
    //   expect(await composableErc721.ownerOf(tokenId)).to.be.equal(rentals.address)
    // })
    // it('should transfer the erc20 token from the tenant to the renter', async () => {
    //   const renterSignature = await getRenterSignature(renter, rentals, renterParams)
    //   renterParams = { ...renterParams, sig: renterSignature }
    //   // Mint and Approve ERC721
    //   await erc721.mint(renter.address, tokenId)
    //   await erc721.connect(renter).approve(rentals.address, tokenId)
    //   // Mint and Approve ERC20
    //   await erc20.mint(tenant.address, ether('100'))
    //   await erc20.connect(tenant).approve(rentals.address, ether('100'))
    //   // Check renter and tenant ERC20 balances
    //   expect(await erc20.balanceOf(renter.address)).to.be.equal(0)
    //   expect(await erc20.balanceOf(tenant.address)).to.be.equal(ether('100'))
    //   // Rent
    //   await rentals.connect(tenant).rent(renterParams, days)
    //   // Check again the renter and tenant ERC20 balances
    //   expect(await erc20.balanceOf(renter.address)).to.be.equal(ether('10'))
    //   expect(await erc20.balanceOf(tenant.address)).to.be.equal(ether('90'))
    // })
    // it('should revert when the recovered renter is not the same as in the params', async () => {
    //   const renterSignature = await getRenterSignature(renter, rentals, { ...renterParams, maxDays: 100 })
    //   await expect(rentals.connect(tenant).rent({ ...renterParams, sig: renterSignature }, days)).to.be.revertedWith(
    //     'Rentals#rent: SIGNER_NOT_RENTER'
    //   )
    // })
    // it('should revert when the price == 0', async () => {
    //   renterParams = { ...renterParams, price: 0 }
    //   const renterSignature = await getRenterSignature(renter, rentals, renterParams)
    //   renterParams = { ...renterParams, sig: renterSignature }
    //   await expect(rentals.connect(tenant).rent(renterParams, days)).to.be.revertedWith('Rentals#rent: INVALID_PRICE')
    // })
    // it('should revert when the expiration is lower than the current time', async () => {
    //   renterParams = { ...renterParams, expiration: latestBlock.timestamp - 100 }
    //   const renterSignature = await getRenterSignature(renter, rentals, renterParams)
    //   renterParams = { ...renterParams, sig: renterSignature }
    //   await expect(rentals.connect(tenant).rent(renterParams, days)).to.be.revertedWith('Rentals#rent: EXPIRED')
    // })
    // it('should revert when _days > maxDays', async () => {
    //   days = 100
    //   const renterSignature = await getRenterSignature(renter, rentals, renterParams)
    //   renterParams = { ...renterParams, sig: renterSignature }
    //   await expect(rentals.connect(tenant).rent(renterParams, days)).to.be.revertedWith('Rentals#rent: TOO_MANY_DAYS')
    // })
    // it('should revert when _days == 0', async () => {
    //   days = 0
    //   const renterSignature = await getRenterSignature(renter, rentals, renterParams)
    //   renterParams = { ...renterParams, sig: renterSignature }
    //   await expect(rentals.connect(tenant).rent(renterParams, days)).to.be.revertedWith('Rentals#rent: ZERO_DAYS')
    // })
    // it('should revert when sender is the same as the renter', async () => {
    //   const renterSignature = await getRenterSignature(renter, rentals, renterParams)
    //   renterParams = { ...renterParams, sig: renterSignature }
    //   await expect(rentals.connect(renter).rent(renterParams, days)).to.be.revertedWith(
    //     'Rentals#rent: RENTER_CANNOT_BE_TENANT'
    //   )
    // })
  })

  // describe('rejectSignatures', () => {
  //   let sig: Uint8Array
  //   let anotherSig: Uint8Array

  //   beforeEach(async () => {
  //     sig = getRandomSignature()
  //     anotherSig = getRandomSignature()
  //     await rentals.connect(deployer).initialize(owner.address, erc20.address)
  //   })

  //   it('should set isSignatureRejected mapping value for the provided signature to true', async () => {
  //     await rentals.rejectSignatures([sig])
  //     const isSignatureRejected = await rentals.isSignatureRejected(sig)
  //     expect(isSignatureRejected).to.be.true
  //   })

  //   it('should set isSignatureRejected mapping value for all the provided signatures to true', async () => {
  //     await rentals.rejectSignatures([sig, anotherSig])
  //     const res = await Promise.all([rentals.isSignatureRejected(sig), rentals.isSignatureRejected(anotherSig)])
  //     expect(res.every((isRejected) => isRejected)).to.be.true
  //   })

  //   it('should revert when no signatures are provided', async () => {
  //     await expect(rentals.rejectSignatures([])).to.be.revertedWith('Rentals#rejectSignatures: EMPTY_SIGNATURE_ARRAY')
  //   })

  //   it('should revert when the signature was already rejected', async () => {
  //     await rentals.rejectSignatures([sig])
  //     await expect(rentals.rejectSignatures([sig])).to.be.revertedWith('Rentals#rejectSignature: ALREADY_REJECTED')
  //   })

  //   it('should revert when the signature has an invalid length', async () => {
  //     const invalidSig = ethers.utils.randomBytes(99)
  //     await expect(rentals.rejectSignatures([invalidSig])).to.be.revertedWith(
  //       'Rentals#rejectSignature: INVALID_SIGNATURE_LENGTH'
  //     )
  //   })
  // })
})
