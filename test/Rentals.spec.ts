import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber } from 'ethers'
import { ethers, network } from 'hardhat'
import { DummyComposableERC721, DummyERC20, DummyERC721 } from '../typechain-types'
import { Rentals } from '../typechain-types/Rentals'
import { daysToSeconds, ether, getLessorSignature, getRandomBytes, getTenantSignature, now } from './utils/rentals'

const zeroAddress = '0x0000000000000000000000000000000000000000'
const maxUint256 = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
const tokenId = 1

describe('Rentals', () => {
  let deployer: SignerWithAddress
  let owner: SignerWithAddress
  let tenant: SignerWithAddress
  let lessor: SignerWithAddress
  let operator: SignerWithAddress
  let rentals: Rentals
  let erc721: DummyERC721
  let composableErc721: DummyComposableERC721
  let erc20: DummyERC20
  let lessorParams: Omit<Rentals.LessorStruct, 'signature'>
  let tenantParams: Omit<Rentals.TenantStruct, 'signature'>
  let snapshotId: any

  beforeEach(async () => {
    snapshotId = await network.provider.send('evm_snapshot')

    // Store addresses
    ;[deployer, owner, tenant, lessor, operator] = await ethers.getSigners()

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

    await erc721.connect(lessor).mint(lessor.address, tokenId)
    await erc721.connect(lessor).approve(rentals.address, tokenId)

    await erc20.connect(tenant).mint(tenant.address, ether('100000'))
    await erc20.connect(tenant).approve(rentals.address, maxUint256)

    lessorParams = {
      signer: lessor.address,
      contractAddress: erc721.address,
      tokenId,
      fingerprint: [],
      pricePerDay: ether('100'),
      expiration: now() + 1000,
      contractNonce: 0,
      signerNonce: 0,
      assetNonce: 0,
      maxDays: 20,
      minDays: 10,
    }

    tenantParams = {
      signer: tenant.address,
      contractAddress: erc721.address,
      tokenId,
      fingerprint: [],
      pricePerDay: ether('100'),
      expiration: now() + 1000,
      contractNonce: 0,
      signerNonce: 0,
      assetNonce: 0,
      rentalDays: 15,
      operator: operator.address,
    }
  })

  afterEach(async () => {
    await network.provider.send('evm_revert', [snapshotId])
  })

  describe('initialize', () => {
    beforeEach(async () => {
      await rentals.connect(deployer).initialize(owner.address, erc20.address)
    })

    it('should set the owner', async () => {
      expect(await rentals.owner()).to.be.equal(owner.address)
    })

    it('should set the erc20 token', async () => {
      expect(await rentals.token()).to.be.equal(erc20.address)
    })

    it('should revert when initialized more than once', async () => {
      await expect(rentals.connect(deployer).initialize(owner.address, erc20.address)).to.be.revertedWith(
        'Initializable: contract is already initialized'
      )
    })
  })

  describe('setToken', () => {
    beforeEach(async () => {
      await rentals.connect(deployer).initialize(owner.address, deployer.address)
    })

    it('should update the erc20 token variable', async () => {
      await rentals.connect(owner).setToken(erc20.address)
      expect(await rentals.token()).to.be.equal(erc20.address)
    })

    it('should emit a TokenSet event', async () => {
      await expect(rentals.connect(owner).setToken(erc20.address)).to.emit(rentals, 'TokenSet').withArgs(erc20.address, owner.address)
    })

    it('should revert when sender is not owner', async () => {
      await expect(rentals.connect(tenant).setToken(erc20.address)).to.be.revertedWith('Ownable: caller is not the owner')
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

    it('should emit a UpdatedContractNonce event', async () => {
      await expect(rentals.connect(owner).bumpContractNonce()).to.emit(rentals, 'UpdatedContractNonce').withArgs(0, 1, owner.address)
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

    it('should emit an UpdatedSignerNonce event', async () => {
      await expect(rentals.connect(lessor).bumpSignerNonce()).to.emit(rentals, 'UpdatedSignerNonce').withArgs(0, 1, lessor.address)
    })
  })

  describe('bumpAssetNonce', () => {
    beforeEach(async () => {
      await rentals.connect(deployer).initialize(owner.address, erc20.address)
    })

    it('should increase the assetNonce for the sender by 1', async () => {
      expect(await rentals.connect(lessor).assetNonce(erc721.address, tokenId, lessor.address)).to.equal(0)
      await rentals.connect(lessor).bumpAssetNonce(erc721.address, tokenId)
      expect(await rentals.connect(lessor).assetNonce(erc721.address, tokenId, lessor.address)).to.equal(1)
    })

    it('should emit an UpdatedAssetNonce event', async () => {
      await expect(rentals.connect(lessor).bumpAssetNonce(erc721.address, tokenId))
        .to.emit(rentals, 'UpdatedAssetNonce')
        .withArgs(0, 1, erc721.address, tokenId, lessor.address, lessor.address)
    })
  })

  describe('getAssetNonce', () => {
    beforeEach(async () => {
      await rentals.connect(deployer).initialize(owner.address, erc20.address)
    })

    it('should return 0 when it is never bumped', async () => {
      expect(await rentals.connect(lessor).getAssetNonce(erc721.address, tokenId, lessor.address)).to.equal(0)
      await rentals.connect(lessor).bumpAssetNonce(erc721.address, tokenId)
      expect(await rentals.connect(lessor).assetNonce(erc721.address, tokenId, lessor.address)).to.equal(1)
    })

    it('should return 1 when it is bumped', async () => {
      await rentals.connect(lessor).bumpAssetNonce(erc721.address, tokenId)
      expect(await rentals.connect(lessor).assetNonce(erc721.address, tokenId, lessor.address)).to.equal(1)
    })

    it('should return 1 for both lessor and tenant after a rent', async () => {
      await rentals
        .connect(lessor)
        .rent(
          { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
          { ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) }
        )

      expect(await rentals.connect(lessor).assetNonce(erc721.address, tokenId, lessor.address)).to.equal(1)
      expect(await rentals.connect(lessor).assetNonce(erc721.address, tokenId, tenant.address)).to.equal(1)
    })
  })

  describe('getOriginalOwner', () => {
    beforeEach(async () => {
      await rentals.connect(deployer).initialize(owner.address, erc20.address)
    })

    it('should return address(0) when nothing is set', async () => {
      expect(await rentals.connect(lessor).getOriginalOwner(erc721.address, tokenId)).to.equal(zeroAddress)
    })

    it('should return the address of the original asset owner after a rent', async () => {
      await rentals
        .connect(lessor)
        .rent(
          { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
          { ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) }
        )

      expect(await rentals.connect(lessor).getOriginalOwner(erc721.address, tokenId)).to.equal(lessor.address)
    })
  })

  describe('getRentalEnd', () => {
    beforeEach(async () => {
      await rentals.connect(deployer).initialize(owner.address, erc20.address)
    })

    it('should return 0 when the asset was never rented', async () => {
      expect(await rentals.connect(lessor).getRentalEnd(erc721.address, tokenId)).to.equal(0)
    })

    it('should return the timestamp of when the rend will finish after being rented', async () => {
      const latestBlock = await ethers.provider.getBlock('latest')
      const latestBlockTime = latestBlock.timestamp

      await rentals
        .connect(lessor)
        .rent(
          { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
          { ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) }
        )

      expect(await rentals.connect(lessor).getRentalEnd(erc721.address, tokenId)).to.equal(
        latestBlockTime + daysToSeconds(tenantParams.rentalDays) + 1
      )
    })
  })

  describe('isRented', () => {
    beforeEach(async () => {
      await rentals.connect(deployer).initialize(owner.address, erc20.address)
    })

    it('should return false when the asset was never rented', async () => {
      expect(await rentals.connect(lessor).isRented(erc721.address, tokenId)).to.equal(false)
    })

    it('should return true after an asset is rented', async () => {
      await rentals
        .connect(lessor)
        .rent(
          { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
          { ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) }
        )

      expect(await rentals.connect(lessor).isRented(erc721.address, tokenId)).to.equal(true)
    })

    it('should return false after and asset is rented and enough time passes to surpass the rental end time', async () => {
      await rentals
        .connect(lessor)
        .rent(
          { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
          { ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) }
        )

      await network.provider.send('evm_increaseTime', [daysToSeconds(tenantParams.rentalDays)])
      await network.provider.send('evm_mine')

      expect(await rentals.connect(lessor).isRented(erc721.address, tokenId)).to.equal(false)
    })
  })

  describe('rent', () => {
    beforeEach(async () => {
      await rentals.connect(deployer).initialize(owner.address, erc20.address)
    })

    it('should emit a RentalStarted event', async () => {
      await expect(
        rentals
          .connect(lessor)
          .rent(
            { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
            { ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) }
          )
      )
        .to.emit(rentals, 'RentalStarted')
        .withArgs(
          tenantParams.contractAddress,
          tenantParams.tokenId,
          lessorParams.signer,
          tenantParams.signer,
          tenantParams.operator,
          tenantParams.rentalDays,
          tenantParams.pricePerDay,
          lessor.address
        )
    })

    it('should emit an UpdatedAssetNonce event for the lessor and the tenant', async () => {
      await expect(
        rentals
          .connect(lessor)
          .rent(
            { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
            { ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) }
          )
      )
        .to.emit(rentals, 'UpdatedAssetNonce')
        .withArgs(0, 1, lessorParams.contractAddress, lessorParams.tokenId, lessorParams.signer, lessor.address)
        .to.emit(rentals, 'UpdatedAssetNonce')
        .withArgs(0, 1, tenantParams.contractAddress, tenantParams.tokenId, tenantParams.signer, lessor.address)
    })

    it('should update original owners with lessor when the contract does not own the asset already', async () => {
      expect(await rentals.connect(lessor).getOriginalOwner(erc721.address, tokenId)).to.equal(zeroAddress)

      await rentals
        .connect(lessor)
        .rent(
          { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
          { ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) }
        )

      expect(await rentals.connect(lessor).getOriginalOwner(erc721.address, tokenId)).to.equal(lessor.address)
    })

    it('should bump both the lessor and tenant asset nonces', async () => {
      expect(await rentals.connect(lessor).getAssetNonce(erc721.address, tokenId, lessor.address)).to.equal(0)
      expect(await rentals.connect(lessor).getAssetNonce(erc721.address, tokenId, tenant.address)).to.equal(0)

      await rentals
        .connect(lessor)
        .rent(
          { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
          { ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) }
        )

      expect(await rentals.connect(lessor).getAssetNonce(erc721.address, tokenId, lessor.address)).to.equal(1)
      expect(await rentals.connect(lessor).getAssetNonce(erc721.address, tokenId, tenant.address)).to.equal(1)
    })

    it('should update the ongoin rentals mapping for the rented asset', async () => {
      expect(await rentals.connect(lessor).getRentalEnd(erc721.address, tokenId)).to.equal(0)

      const latestBlock = await ethers.provider.getBlock('latest')
      const latestBlockTime = latestBlock.timestamp

      await rentals
        .connect(lessor)
        .rent(
          { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
          { ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) }
        )

      expect(await rentals.connect(lessor).getRentalEnd(erc721.address, tokenId)).to.equal(
        latestBlockTime + daysToSeconds(tenantParams.rentalDays) + 1
      )
    })

    it('should revert when the lessor signer does not match the signer in params', async () => {
      await expect(
        rentals
          .connect(lessor)
          .rent(
            { ...lessorParams, signature: await getLessorSignature(lessor, rentals, { ...lessorParams, signer: tenant.address }) },
            { ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) }
          )
      ).to.be.revertedWith('Rentals#_verifySignatures: INVALID_LESSOR_SIGNATURE')
    })

    it('should revert when the tenant signer does not match the signer provided in params', async () => {
      await expect(
        rentals
          .connect(lessor)
          .rent(
            { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
            { ...tenantParams, signature: await getTenantSignature(tenant, rentals, { ...tenantParams, signer: lessor.address }) }
          )
      ).to.be.revertedWith('Rentals#_verifySignatures: INVALID_TENANT_SIGNATURE')
    })

    it('should revert when the block timestamp is higher than the provided lessor signature expiration', async () => {
      lessorParams = { ...lessorParams, expiration: now() - 1000 }

      await expect(
        rentals
          .connect(lessor)
          .rent(
            { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
            { ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) }
          )
      ).to.be.revertedWith('Rentals#_verify: EXPIRED_LESSOR_SIGNATURE')
    })

    it('should revert when the block timestamp is higher than the provided tenant signature expiration', async () => {
      tenantParams = { ...tenantParams, expiration: now() - 1000 }

      await expect(
        rentals
          .connect(lessor)
          .rent(
            { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
            { ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) }
          )
      ).to.be.revertedWith('Rentals#_verify: EXPIRED_TENANT_SIGNATURE')
    })

    it('should revert when max days is lower than min days', async () => {
      lessorParams = { ...lessorParams, minDays: BigNumber.from(lessorParams.maxDays).add(1) }

      await expect(
        rentals
          .connect(lessor)
          .rent(
            { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
            { ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) }
          )
      ).to.be.revertedWith('Rentals#_verify: MAX_DAYS_LOWER_THAN_MIN_DAYS')
    })

    it('should revert when min days is 0', async () => {
      lessorParams = { ...lessorParams, minDays: 0 }

      await expect(
        rentals
          .connect(lessor)
          .rent(
            { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
            { ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) }
          )
      ).to.be.revertedWith('Rentals#_verify: MIN_DAYS_0')
    })

    it('should revert when tenant days is lower than lessor min days', async () => {
      tenantParams = { ...tenantParams, rentalDays: BigNumber.from(lessorParams.minDays).sub(1) }

      await expect(
        rentals
          .connect(lessor)
          .rent(
            { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
            { ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) }
          )
      ).to.be.revertedWith('Rentals#_verify: DAYS_NOT_IN_RANGE')
    })

    it('should revert when tenant days is higher than lessor max days', async () => {
      tenantParams = { ...tenantParams, rentalDays: BigNumber.from(lessorParams.maxDays).add(1) }

      await expect(
        rentals
          .connect(lessor)
          .rent(
            { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
            { ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) }
          )
      ).to.be.revertedWith('Rentals#_verify: DAYS_NOT_IN_RANGE')
    })

    it('should revert when lessor and tenant provide different price per day', async () => {
      tenantParams = { ...tenantParams, pricePerDay: BigNumber.from(lessorParams.pricePerDay).add(1) }

      await expect(
        rentals
          .connect(lessor)
          .rent(
            { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
            { ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) }
          )
      ).to.be.revertedWith('Rentals#_verify: DIFFERENT_PRICE')
    })

    it('should revert when lessor and tenant provide different contract addresses', async () => {
      tenantParams = { ...tenantParams, contractAddress: lessor.address }

      await expect(
        rentals
          .connect(lessor)
          .rent(
            { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
            { ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) }
          )
      ).to.be.revertedWith('Rentals#_verify: DIFFERENT_CONTRACT_ADDRESS')
    })

    it('should revert when lessor and tenant provide different token ids', async () => {
      tenantParams = { ...tenantParams, tokenId: 200 }

      await expect(
        rentals
          .connect(lessor)
          .rent(
            { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
            { ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) }
          )
      ).to.be.revertedWith('Rentals#_verify: DIFFERENT_TOKEN_ID')
    })

    it('should revert when lessor and tenant provide different fingerprints', async () => {
      tenantParams = { ...tenantParams, fingerprint: getRandomBytes() }

      await expect(
        rentals
          .connect(lessor)
          .rent(
            { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
            { ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) }
          )
      ).to.be.revertedWith('Rentals#_verify: DIFFERENT_FINGERPRINT')
    })

    it('should revert when lessor contract nonce is not the same as the contract', async () => {
      lessorParams = { ...lessorParams, contractNonce: 1 }

      await expect(
        rentals
          .connect(lessor)
          .rent(
            { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
            { ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) }
          )
      ).to.be.revertedWith('Rentals#_verify: INVALID_LESSOR_CONTRACT_NONCE')
    })

    it('should revert when tenant contract nonce is not the same as the contract', async () => {
      tenantParams = { ...tenantParams, contractNonce: 1 }

      await expect(
        rentals
          .connect(lessor)
          .rent(
            { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
            { ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) }
          )
      ).to.be.revertedWith('Rentals#_verify: INVALID_TENANT_CONTRACT_NONCE')
    })

    it('should revert when lessor signer nonce is not the same as the contract', async () => {
      lessorParams = { ...lessorParams, signerNonce: 1 }

      await expect(
        rentals
          .connect(lessor)
          .rent(
            { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
            { ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) }
          )
      ).to.be.revertedWith('Rentals#_verify: INVALID_LESSOR_SIGNER_NONCE')
    })

    it('should revert when tenant signer nonce is not the same as the contract', async () => {
      tenantParams = { ...tenantParams, signerNonce: 1 }

      await expect(
        rentals
          .connect(lessor)
          .rent(
            { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
            { ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) }
          )
      ).to.be.revertedWith('Rentals#_verify: INVALID_TENANT_SIGNER_NONCE')
    })

    it('should revert when lessor asset nonce is not the same as the contract', async () => {
      lessorParams = { ...lessorParams, assetNonce: 1 }

      await expect(
        rentals
          .connect(lessor)
          .rent(
            { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
            { ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) }
          )
      ).to.be.revertedWith('Rentals#_verifyAssetNonces: INVALID_LESSOR_ASSET_NONCE')
    })

    it('should revert when tenant asset nonce is not the same as the contract', async () => {
      tenantParams = { ...tenantParams, assetNonce: 1 }

      await expect(
        rentals
          .connect(lessor)
          .rent(
            { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
            { ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) }
          )
      ).to.be.revertedWith('Rentals#_verifyAssetNonces: INVALID_TENANT_ASSET_NONCE')
    })

    it("should revert when the provided contract address's `verifyFingerprint` returns false", async () => {
      const DummyFalseVerifyFingerprintFactory = await ethers.getContractFactory('DummyFalseVerifyFingerprint')
      const falseVerifyFingerprint = await DummyFalseVerifyFingerprintFactory.connect(deployer).deploy()

      lessorParams = { ...lessorParams, contractAddress: falseVerifyFingerprint.address, fingerprint: getRandomBytes() }
      tenantParams = { ...tenantParams, contractAddress: lessorParams.contractAddress, fingerprint: lessorParams.fingerprint }

      await expect(
        rentals
          .connect(lessor)
          .rent(
            { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
            { ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) }
          )
      ).to.be.revertedWith('Rentals#rent: INVALID_FINGERPRINT')
    })

    it('should revert if an asset is already being rented', async () => {
      rentals
        .connect(lessor)
        .rent(
          { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
          { ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) }
        )

      lessorParams = { ...lessorParams, assetNonce: 1 }
      tenantParams = { ...tenantParams, assetNonce: 1 }

      await expect(
        rentals
          .connect(lessor)
          .rent(
            { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
            { ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) }
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

      await network.provider.send('evm_increaseTime', [daysToSeconds(tenantParams.rentalDays)])
      await network.provider.send('evm_mine')

      lessorParams = { ...lessorParams, signer: tenant.address, expiration: maxUint256, assetNonce: 1 }
      tenantParams = { ...tenantParams, signer: lessor.address, expiration: maxUint256, assetNonce: 1 }

      await expect(
        rentals
          .connect(tenant)
          .rent(
            { ...lessorParams, signature: await getLessorSignature(tenant, rentals, lessorParams) },
            { ...tenantParams, signature: await getTenantSignature(lessor, rentals, tenantParams) }
          )
      ).to.be.revertedWith('Rentals#rent: NOT_ORIGINAL_OWNER')
    })
  })

  describe('claim', () => {
    beforeEach(async () => {
      await rentals.connect(deployer).initialize(owner.address, erc20.address)
    })

    it('should set the original owner to address(0)', async () => {
      await rentals
        .connect(lessor)
        .rent(
          { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
          { ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) }
        )

      await network.provider.send('evm_increaseTime', [daysToSeconds(tenantParams.rentalDays)])
      await network.provider.send('evm_mine')

      await rentals.connect(lessor).claim(erc721.address, tokenId)

      expect(await rentals.getOriginalOwner(erc721.address, tokenId)).to.equal(zeroAddress)
    })

    it('should transfer the asset to the original owner', async () => {
      await rentals
        .connect(lessor)
        .rent(
          { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
          { ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) }
        )

      await network.provider.send('evm_increaseTime', [daysToSeconds(tenantParams.rentalDays)])
      await network.provider.send('evm_mine')

      expect(await erc721.ownerOf(tokenId)).to.equal(rentals.address)

      await rentals.connect(lessor).claim(erc721.address, tokenId)

      expect(await erc721.ownerOf(tokenId)).to.equal(lessor.address)
    })

    it('should revert when the asset is currently being rented', async () => {
      await rentals
        .connect(lessor)
        .rent(
          { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
          { ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) }
        )

      await expect(rentals.connect(lessor).claim(erc721.address, tokenId)).to.be.revertedWith('Rentals#claim: CURRENTLY_RENTED')
    })

    it('should revert when the caller is not the original owner of the asset', async () => {
      await rentals
        .connect(lessor)
        .rent(
          { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
          { ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) }
        )

      await network.provider.send('evm_increaseTime', [daysToSeconds(tenantParams.rentalDays)])
      await network.provider.send('evm_mine')

      await expect(rentals.connect(tenant).claim(erc721.address, tokenId)).to.be.revertedWith('Rentals#claim: NOT_ORIGINAL_OWNER')
    })
  })

  describe('setUpdateOperator', () => {
    beforeEach(async () => {
      await rentals.connect(deployer).initialize(owner.address, erc20.address)
    })

    it('should allow the original owner to set the operator of an asset owned by the contract if it is not rented', async () => {
      await rentals
        .connect(lessor)
        .rent(
          { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
          { ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) }
        )

      await network.provider.send('evm_increaseTime', [daysToSeconds(tenantParams.rentalDays)])
      await network.provider.send('evm_mine')

      await rentals.connect(lessor).setUpdateOperator(erc721.address, tokenId, zeroAddress)
    })

    it('should revert if the contract does not have the asset', async () => {
      await expect(rentals.connect(lessor).setUpdateOperator(erc721.address, tokenId, zeroAddress)).to.be.revertedWith(
        'Rentals#setUpdateOperator: NOT_ORIGINAL_OWNER'
      )
    })

    it('should revert the caller is not the original owner of the asset', async () => {
      await rentals
        .connect(lessor)
        .rent(
          { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
          { ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) }
        )

      await network.provider.send('evm_increaseTime', [daysToSeconds(tenantParams.rentalDays)])
      await network.provider.send('evm_mine')

      await expect(rentals.connect(tenant).setUpdateOperator(erc721.address, tokenId, zeroAddress)).to.be.revertedWith(
        'Rentals#setUpdateOperator: NOT_ORIGINAL_OWNER'
      )
    })
  })

  describe('onERC721Received', () => {
    beforeEach(async () => {
      await rentals.connect(deployer).initialize(owner.address, erc20.address)
    })

    it('should allow the asset transfer from a rent', async () => {
      expect(await erc721.ownerOf(tokenId)).to.equal(lessor.address)

      await rentals
        .connect(lessor)
        .rent(
          { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
          { ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) }
        )

      expect(await erc721.ownerOf(tokenId)).to.equal(rentals.address)
    })

    it('should revert when the contract receives an asset not transfered via rent', async () => {
      const transfer = erc721.connect(lessor)['safeTransferFrom(address,address,uint256)'](lessor.address, rentals.address, tokenId)
      await expect(transfer).to.be.revertedWith('Rentals#onERC721Received: ONLY_ACCEPT_TRANSFERS_FROM_THIS_CONTRACT')
    })
  })
})
