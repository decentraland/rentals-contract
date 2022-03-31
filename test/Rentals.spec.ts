import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber } from 'ethers'
import { ethers, network } from 'hardhat'
import { DummyComposableERC721, DummyERC20, DummyERC721 } from '../typechain-types'
import { Rentals } from '../typechain-types/Rentals'
import { ether, getLessorSignature, getRandomBytes, getTenantSignature, now } from './utils/rentals'

const maxUint256 = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'

describe('Rentals', () => {
  let deployer: SignerWithAddress
  let owner: SignerWithAddress
  let tenant: SignerWithAddress
  let lessor: SignerWithAddress
  let rentals: Rentals
  let erc721: DummyERC721
  let composableErc721: DummyComposableERC721
  let erc20: DummyERC20

  beforeEach(async () => {
    // Store addresses
    ;[deployer, owner, tenant, lessor] = await ethers.getSigners()

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
      await rentals.connect(deployer).initialize(owner.address, erc20.address)
    })

    it('should set the owner', async () => {
      expect(await rentals.owner()).to.be.equal(owner.address)
    })

    it('should set the erc20 token', async () => {
      expect(await rentals.erc20Token()).to.be.equal(erc20.address)
    })

    it('should revert when initialized more than once', async () => {
      await expect(rentals.connect(deployer).initialize(owner.address, erc20.address)).to.be.revertedWith(
        'Initializable: contract is already initialized'
      )
    })
  })

  describe('setERC20Token', () => {
    beforeEach(async () => {
      await rentals.connect(deployer).initialize(owner.address, deployer.address)
    })

    it('should update the erc20 token variable', async () => {
      await rentals.connect(owner).setERC20Token(erc20.address)
      expect(await rentals.erc20Token()).to.be.equal(erc20.address)
    })

    it('should revert when sender is not owner', async () => {
      await expect(rentals.connect(tenant).setERC20Token(erc20.address)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )
    })
  })

  describe('bumpContractNonce', () => {
    beforeEach(async () => {
      await rentals.connect(deployer).initialize(owner.address, erc20.address)
    })

    it('should increase the contractNonce by 1', async () => {
      expect(await rentals.connect(owner).contractNonce()).to.equal(0)
      await rentals.connect(owner).bumpContractNonce()
      expect(await rentals.connect(owner).contractNonce()).to.equal(1)
    })

    it('should revert when the contract owner is not the caller', async () => {
      await expect(rentals.connect(tenant).bumpContractNonce()).to.be.revertedWith('Ownable: caller is not the owner')
    })
  })

  describe('bumpSignerNonce', () => {
    beforeEach(async () => {
      await rentals.connect(deployer).initialize(owner.address, erc20.address)
    })

    it('should increase the signerNonce for the sender by 1', async () => {
      expect(await rentals.connect(lessor).signerNonce(lessor.address)).to.equal(0)
      await rentals.connect(lessor).bumpSignerNonce()
      expect(await rentals.connect(lessor).signerNonce(lessor.address)).to.equal(1)
    })
  })

  describe('rent', () => {
    let lessorParams: Omit<Rentals.LessorStruct, 'signature'>
    let tenantParams: Omit<Rentals.TenantStruct, 'signature'>

    beforeEach(async () => {
      lessorParams = {
        signer: lessor.address,
        contractAddress: erc721.address,
        tokenId: 1,
        fingerprint: [],
        pricePerDay: ether('100'),
        expiration: now() + 1000,
        contractNonce: 0,
        signerNonce: 0,
        maxDays: 20,
        minDays: 10,
      }

      tenantParams = {
        signer: tenant.address,
        contractAddress: erc721.address,
        tokenId: 1,
        fingerprint: [],
        pricePerDay: ether('100'),
        expiration: now() + 1000,
        contractNonce: 0,
        signerNonce: 0,
        _days: 15,
      }

      await rentals.connect(deployer).initialize(owner.address, erc20.address)

      await erc721.connect(deployer).mint(lessor.address, 1)

      await erc721.connect(lessor).approve(rentals.address, 1)

      await erc20.connect(deployer).mint(tenant.address, ether('100000'))

      await erc20.connect(tenant).approve(rentals.address, maxUint256)
    })

    it('should revert when the owner signer does not match the owner in params', async () => {
      await expect(
        rentals.connect(lessor).rent(
          {
            ...lessorParams,
            signature: await getLessorSignature(lessor, rentals, {
              ...lessorParams,
              signer: tenant.address,
            }),
          },
          {
            ...tenantParams,
            signature: await getTenantSignature(tenant, rentals, tenantParams),
          }
        )
      ).to.be.revertedWith('Rentals#rent: INVALID_LESSOR_SIGNATURE')
    })

    it('should revert when the user signer does not match the user provided in params', async () => {
      await expect(
        rentals.connect(lessor).rent(
          {
            ...lessorParams,
            signature: await getLessorSignature(lessor, rentals, lessorParams),
          },
          {
            ...tenantParams,
            signature: await getTenantSignature(tenant, rentals, { ...tenantParams, signer: lessor.address }),
          }
        )
      ).to.be.revertedWith('Rentals#rent: INVALID_TENANT_SIGNATURE')
    })

    it('should revert when the block timestamp is higher than the provided owner signature expiration', async () => {
      lessorParams = { ...lessorParams, expiration: now() - 1000 }

      await expect(
        rentals.connect(lessor).rent(
          {
            ...lessorParams,
            signature: await getLessorSignature(lessor, rentals, lessorParams),
          },
          {
            ...tenantParams,
            signature: await getTenantSignature(tenant, rentals, tenantParams),
          }
        )
      ).to.be.revertedWith('Rentals#rent: EXPIRED_LESSOR_SIGNATURE')
    })

    it('should revert when the block timestamp is higher than the provided user signature expiration', async () => {
      tenantParams = { ...tenantParams, expiration: now() - 1000 }

      await expect(
        rentals.connect(lessor).rent(
          {
            ...lessorParams,
            signature: await getLessorSignature(lessor, rentals, lessorParams),
          },
          {
            ...tenantParams,
            signature: await getTenantSignature(tenant, rentals, tenantParams),
          }
        )
      ).to.be.revertedWith('Rentals#rent: EXPIRED_TENANT_SIGNATURE')
    })

    it('should revert when max days is lower than min days', async () => {
      lessorParams = { ...lessorParams, minDays: BigNumber.from(lessorParams.maxDays).add(1) }

      await expect(
        rentals.connect(lessor).rent(
          {
            ...lessorParams,
            signature: await getLessorSignature(lessor, rentals, lessorParams),
          },
          {
            ...tenantParams,
            signature: await getTenantSignature(tenant, rentals, tenantParams),
          }
        )
      ).to.be.revertedWith('Rentals#rent: MAX_DAYS_NOT_GE_THAN_MIN_DAYS')
    })

    it('should revert when user days is lower than owner min days', async () => {
      tenantParams = { ...tenantParams, _days: BigNumber.from(lessorParams.minDays).sub(1) }

      await expect(
        rentals.connect(lessor).rent(
          {
            ...lessorParams,
            signature: await getLessorSignature(lessor, rentals, lessorParams),
          },
          {
            ...tenantParams,
            signature: await getTenantSignature(tenant, rentals, tenantParams),
          }
        )
      ).to.be.revertedWith('Rentals#rent: DAYS_NOT_IN_RANGE')
    })

    it('should revert when user days is higher than owner max days', async () => {
      tenantParams = { ...tenantParams, _days: BigNumber.from(lessorParams.maxDays).add(1) }

      await expect(
        rentals.connect(lessor).rent(
          {
            ...lessorParams,
            signature: await getLessorSignature(lessor, rentals, lessorParams),
          },
          {
            ...tenantParams,
            signature: await getTenantSignature(tenant, rentals, tenantParams),
          }
        )
      ).to.be.revertedWith('Rentals#rent: DAYS_NOT_IN_RANGE')
    })

    it('should revert when owner and user provide different price per day', async () => {
      tenantParams = { ...tenantParams, pricePerDay: BigNumber.from(lessorParams.pricePerDay).add(1) }

      await expect(
        rentals.connect(lessor).rent(
          {
            ...lessorParams,
            signature: await getLessorSignature(lessor, rentals, lessorParams),
          },
          {
            ...tenantParams,
            signature: await getTenantSignature(tenant, rentals, tenantParams),
          }
        )
      ).to.be.revertedWith('Rentals#rent: DIFFERENT_PRICE')
    })

    it('should revert when owner and user provide different contract addresses', async () => {
      tenantParams = { ...tenantParams, contractAddress: lessor.address }

      await expect(
        rentals.connect(lessor).rent(
          {
            ...lessorParams,
            signature: await getLessorSignature(lessor, rentals, lessorParams),
          },
          {
            ...tenantParams,
            signature: await getTenantSignature(tenant, rentals, tenantParams),
          }
        )
      ).to.be.revertedWith('Rentals#rent: DIFFERENT_CONTRACT_ADDRESS')
    })

    it('should revert when owner and user provide different token ids', async () => {
      tenantParams = { ...tenantParams, tokenId: 200 }

      await expect(
        rentals.connect(lessor).rent(
          {
            ...lessorParams,
            signature: await getLessorSignature(lessor, rentals, lessorParams),
          },
          {
            ...tenantParams,
            signature: await getTenantSignature(tenant, rentals, tenantParams),
          }
        )
      ).to.be.revertedWith('Rentals#rent: DIFFERENT_TOKEN_ID')
    })

    it('should revert when owner and user provide different fingerprints', async () => {
      tenantParams = { ...tenantParams, fingerprint: getRandomBytes() }

      await expect(
        rentals.connect(lessor).rent(
          {
            ...lessorParams,
            signature: await getLessorSignature(lessor, rentals, lessorParams),
          },
          {
            ...tenantParams,
            signature: await getTenantSignature(tenant, rentals, tenantParams),
          }
        )
      ).to.be.revertedWith('Rentals#rent: DIFFERENT_FINGERPRINT')
    })

    it('should revert when owner contract nonce is not the same as the contract', async () => {
      lessorParams = { ...lessorParams, contractNonce: 1 }

      await expect(
        rentals.connect(lessor).rent(
          {
            ...lessorParams,
            signature: await getLessorSignature(lessor, rentals, lessorParams),
          },
          {
            ...tenantParams,
            signature: await getTenantSignature(tenant, rentals, tenantParams),
          }
        )
      ).to.be.revertedWith('Rentals#rent: INVALID_LESSOR_CONTRACT_NONCE')
    })

    it('should revert when user contract nonce is not the same as the contract', async () => {
      tenantParams = { ...tenantParams, contractNonce: 1 }

      await expect(
        rentals.connect(lessor).rent(
          {
            ...lessorParams,
            signature: await getLessorSignature(lessor, rentals, lessorParams),
          },
          {
            ...tenantParams,
            signature: await getTenantSignature(tenant, rentals, tenantParams),
          }
        )
      ).to.be.revertedWith('Rentals#rent: INVALID_TENANT_CONTRACT_NONCE')
    })

    it('should revert when owner signer nonce is not the same as the contract', async () => {
      lessorParams = { ...lessorParams, signerNonce: 1 }

      await expect(
        rentals.connect(lessor).rent(
          {
            ...lessorParams,
            signature: await getLessorSignature(lessor, rentals, lessorParams),
          },
          {
            ...tenantParams,
            signature: await getTenantSignature(tenant, rentals, tenantParams),
          }
        )
      ).to.be.revertedWith('Rentals#rent: INVALID_LESSOR_SIGNER_NONCE')
    })

    it('should revert when user signer nonce is not the same as the contract', async () => {
      tenantParams = { ...tenantParams, signerNonce: 1 }

      await expect(
        rentals.connect(lessor).rent(
          {
            ...lessorParams,
            signature: await getLessorSignature(lessor, rentals, lessorParams),
          },
          {
            ...tenantParams,
            signature: await getTenantSignature(tenant, rentals, tenantParams),
          }
        )
      ).to.be.revertedWith('Rentals#rent: INVALID_TENANT_SIGNER_NONCE')
    })

    it("should revert when the provided contract address's `verifyFingerprint` returns false", async () => {
      const DummyFalseVerifyFingerprintFactory = await ethers.getContractFactory('DummyFalseVerifyFingerprint')
      const falseVerifyFingerprint = await DummyFalseVerifyFingerprintFactory.connect(deployer).deploy()

      lessorParams = {
        ...lessorParams,
        contractAddress: falseVerifyFingerprint.address,
        fingerprint: getRandomBytes(),
      }

      tenantParams = {
        ...tenantParams,
        contractAddress: lessorParams.contractAddress,
        fingerprint: lessorParams.fingerprint,
      }

      await expect(
        rentals.connect(lessor).rent(
          {
            ...lessorParams,
            signature: await getLessorSignature(lessor, rentals, lessorParams),
          },
          {
            ...tenantParams,
            signature: await getTenantSignature(tenant, rentals, tenantParams),
          }
        )
      ).to.be.revertedWith('Rentals#rent: INVALID_FINGERPRINT')
    })

    // Skipped because the DummyFalseVerifyFingerprint does not implement any ERC721 functions needed for the rest of the
    // rent function to work.
    // TODO: Find an alternative to test this.
    it("should NOT revert when an empty fingerprint is provided and the provided contract address's `verifyFingerprint` returns false", async () => {
      const DummyFalseVerifyFingerprintFactory = await ethers.getContractFactory('DummyFalseVerifyFingerprint')
      const falseVerifyFingerprint = await DummyFalseVerifyFingerprintFactory.connect(deployer).deploy()

      await falseVerifyFingerprint.connect(lessor).mint(lessor.address, 1)
      await falseVerifyFingerprint.connect(lessor).approve(rentals.address, 1)

      lessorParams = {
        ...lessorParams,
        contractAddress: falseVerifyFingerprint.address,
      }

      tenantParams = {
        ...tenantParams,
        contractAddress: lessorParams.contractAddress,
      }

      await rentals.connect(lessor).rent(
        {
          ...lessorParams,
          signature: await getLessorSignature(lessor, rentals, lessorParams),
        },
        {
          ...tenantParams,
          signature: await getTenantSignature(tenant, rentals, tenantParams),
        }
      )
    })

    it('should revert if an asset is already being rented', async () => {
      rentals.connect(lessor).rent(
        {
          ...lessorParams,
          signature: await getLessorSignature(lessor, rentals, lessorParams),
        },
        {
          ...tenantParams,
          signature: await getTenantSignature(tenant, rentals, tenantParams),
        }
      )

      await expect(
        rentals.connect(lessor).rent(
          {
            ...lessorParams,
            signature: await getLessorSignature(lessor, rentals, lessorParams),
          },
          {
            ...tenantParams,
            signature: await getTenantSignature(tenant, rentals, tenantParams),
          }
        )
      ).to.be.revertedWith('Rentals#rent: CURRENTLY_RENTED')
    })

    it('should revert if someone other than the original owner wants to rent an asset currently owned by the contract', async () => {
      await rentals
        .connect(lessor)
        .rent(
          { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
          { ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) }
        )

      const skip = BigNumber.from(tenantParams._days).mul(86400).toNumber() + 1000

      // Skip for a little more than the required amount of time to finish the previous rent
      await network.provider.send('evm_increaseTime', [skip])

      lessorParams = { ...lessorParams, signer: tenant.address, expiration: maxUint256 }
      tenantParams = { ...tenantParams, signer: lessor.address, expiration: maxUint256 }

      await expect(
        rentals.connect(tenant).rent(
          {
            ...lessorParams,
            signature: await getLessorSignature(tenant, rentals, lessorParams),
          },
          {
            ...tenantParams,
            signature: await getTenantSignature(lessor, rentals, tenantParams),
          }
        )
      ).to.be.revertedWith('Rentals#rent: NOT_ORIGINAL_OWNER')
    })
  })
})
