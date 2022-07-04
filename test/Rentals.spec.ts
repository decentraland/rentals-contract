import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, BigNumberish } from 'ethers'
import { ParamType } from 'ethers/lib/utils'
import { ethers, network } from 'hardhat'
import { off } from 'process'
import { EstateRegistry, LANDRegistry, MANAToken, Rentals } from '../typechain-types'
import {
  daysToSeconds,
  ether,
  getListingSignature,
  getMetaTxSignature,
  getOfferSignature,
  getZeroBytes32,
  now,
  evmMine,
  evmIncreaseTime,
  getLatestBlockTimestamp,
} from './utils/rentals'

const zeroAddress = '0x0000000000000000000000000000000000000000'
const maxUint256 = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
const estateId = 1
const fee = '100000' // 10% fee

describe('Rentals', () => {
  let deployer: SignerWithAddress
  let owner: SignerWithAddress
  let tenant: SignerWithAddress
  let lessor: SignerWithAddress
  let operator: SignerWithAddress
  let collector: SignerWithAddress
  let extra: SignerWithAddress
  let rentals: Rentals
  let land: LANDRegistry
  let estate: EstateRegistry
  let tokenId: BigNumber
  let mana: MANAToken
  let listingParams: Omit<Rentals.ListingStruct, 'signature'>
  let offerParams: Omit<Rentals.OfferStruct, 'signature'>
  let acceptListingParams: Pick<typeof offerParams, 'operator' | 'rentalDays' | 'fingerprint'> & { index: BigNumberish }
  let snapshotId: any

  beforeEach(async () => {
    snapshotId = await network.provider.send('evm_snapshot')

    // Store addresses
    ;[deployer, owner, tenant, lessor, operator, collector, extra] = await ethers.getSigners()

    // Deploy Rentals contract
    const RentalsFactory = await ethers.getContractFactory('Rentals')
    rentals = await RentalsFactory.connect(deployer).deploy()

    // Deploy and Prepare LANDRegistry
    const LANDRegistryFactory = await ethers.getContractFactory('LANDRegistry')
    const landRegistry = await LANDRegistryFactory.connect(deployer).deploy()

    const LANDProxyFactory = await ethers.getContractFactory('LANDProxy')
    const landProxy = await LANDProxyFactory.connect(deployer).deploy()

    await landProxy.connect(deployer).upgrade(landRegistry.address, [])

    land = await ethers.getContractAt('LANDRegistry', landProxy.address)

    await land.connect(deployer).assignNewParcel(0, 0, lessor.address)

    tokenId = await land.encodeTokenId(0, 0)

    await land.connect(lessor).setApprovalForAll(rentals.address, true)

    // Deploy and Prepare EstateRegistry
    const EstateRegistryFactory = await ethers.getContractFactory('EstateRegistry')
    const estateRegistry = await EstateRegistryFactory.connect(deployer).deploy()

    const EstateProxyFactory = await ethers.getContractFactory('AdminUpgradeabilityProxy')
    const estateProxy = await EstateProxyFactory.connect(deployer).deploy(estateRegistry.address)

    await estateProxy.connect(deployer).changeAdmin(extra.address)

    estate = await ethers.getContractAt('EstateRegistry', estateProxy.address)

    await estate['initialize(string,string,address)']('Estate', 'EST', land.address)

    await estate.connect(deployer).transferOwnership(owner.address)

    await estateProxy.connect(extra).changeAdmin(deployer.address)

    await land.connect(deployer).setEstateRegistry(estate.address)

    await land.connect(deployer).assignNewParcel(1, 1, lessor.address)
    await land.connect(deployer).assignNewParcel(1, 2, lessor.address)
    await land.connect(deployer).assignNewParcel(2, 1, lessor.address)
    await land.connect(deployer).assignNewParcel(2, 2, lessor.address)

    await land.connect(lessor).createEstate([1, 1, 2, 2], [1, 2, 1, 2], lessor.address)

    await estate.connect(lessor).setApprovalForAll(rentals.address, true)

    // Deploy and Prepare MANAToken
    const MANATokenFactory = await ethers.getContractFactory('MANAToken')
    mana = await MANATokenFactory.connect(deployer).deploy()

    await mana.connect(deployer).mint(tenant.address, ether('100000'))
    await mana.connect(tenant).approve(rentals.address, maxUint256)

    listingParams = {
      signer: lessor.address,
      contractAddress: land.address,
      tokenId,
      expiration: now() + 1000,
      nonces: [0, 0, 0],
      pricePerDay: [ether('100')],
      maxDays: [20],
      minDays: [10],
      target: zeroAddress,
    }

    offerParams = {
      signer: tenant.address,
      contractAddress: land.address,
      tokenId,
      fingerprint: getZeroBytes32(),
      pricePerDay: ether('100'),
      expiration: now() + 1000,
      nonces: [0, 0, 0],
      rentalDays: 15,
      operator: operator.address,
    }

    acceptListingParams = {
      operator: offerParams.operator,
      index: 0,
      rentalDays: offerParams.rentalDays,
      fingerprint: offerParams.fingerprint,
    }
  })

  afterEach(async () => {
    await network.provider.send('evm_revert', [snapshotId])
  })

  describe('initialize', () => {
    beforeEach(async () => {
      await rentals.connect(deployer).initialize(owner.address, mana.address, collector.address, fee)
    })

    it('should set the owner', async () => {
      expect(await rentals.owner()).to.be.equal(owner.address)
    })

    it('should set the erc20 token', async () => {
      expect(await rentals.token()).to.be.equal(mana.address)
    })

    it('should set the fee collector', async () => {
      expect(await rentals.feeCollector()).to.be.equal(collector.address)
    })

    it('should set the fee', async () => {
      expect(await rentals.fee()).to.be.equal(fee)
    })

    it('should revert when initialized more than once', async () => {
      await expect(rentals.connect(deployer).initialize(owner.address, mana.address, collector.address, fee)).to.be.revertedWith(
        'Initializable: contract is already initialized'
      )
    })
  })

  describe('setToken', () => {
    let oldToken: string
    let newToken: string

    beforeEach(async () => {
      oldToken = mana.address
      newToken = deployer.address

      await rentals.connect(deployer).initialize(owner.address, oldToken, collector.address, fee)
    })

    it('should update the erc20 token variable', async () => {
      await rentals.connect(owner).setToken(newToken)
      expect(await rentals.token()).to.be.equal(newToken)
    })

    it('should emit a TokenUpdated event', async () => {
      await expect(rentals.connect(owner).setToken(newToken)).to.emit(rentals, 'TokenUpdated').withArgs(oldToken, newToken, owner.address)
    })

    it('should accept a meta tx', async () => {
      const abi = ['function setToken(address _token)']
      const iface = new ethers.utils.Interface(abi)
      const functionData = iface.encodeFunctionData('setToken', [newToken])
      const metaTxSignature = await getMetaTxSignature(owner, rentals, functionData)

      await rentals.connect(owner).executeMetaTransaction(owner.address, functionData, metaTxSignature)

      expect(await rentals.token()).to.be.equal(newToken)
    })

    it('should revert when sender is not owner', async () => {
      await expect(rentals.connect(tenant).setToken(newToken)).to.be.revertedWith('Ownable: caller is not the owner')
    })
  })

  describe('setFeeCollector', () => {
    let oldFeeCollector: string
    let newFeeCollector: string

    beforeEach(async () => {
      oldFeeCollector = collector.address
      newFeeCollector = deployer.address

      await rentals.connect(deployer).initialize(owner.address, deployer.address, oldFeeCollector, fee)
    })

    it('should update the feeCollector variable', async () => {
      await rentals.connect(owner).setFeeCollector(newFeeCollector)
      expect(await rentals.feeCollector()).to.be.equal(newFeeCollector)
    })

    it('should emit a FeeCollectorUpdated event', async () => {
      await expect(rentals.connect(owner).setFeeCollector(newFeeCollector))
        .to.emit(rentals, 'FeeCollectorUpdated')
        .withArgs(oldFeeCollector, newFeeCollector, owner.address)
    })

    it('should accept a meta tx', async () => {
      const abi = ['function setFeeCollector(address _feeCollector)']
      const iface = new ethers.utils.Interface(abi)
      const functionData = iface.encodeFunctionData('setFeeCollector', [newFeeCollector])
      const metaTxSignature = await getMetaTxSignature(owner, rentals, functionData)

      await rentals.connect(owner).executeMetaTransaction(owner.address, functionData, metaTxSignature)

      expect(await rentals.feeCollector()).to.be.equal(newFeeCollector)
    })

    it('should revert when sender is not owner', async () => {
      await expect(rentals.connect(tenant).setFeeCollector(newFeeCollector)).to.be.revertedWith('Ownable: caller is not the owner')
    })
  })

  describe('setFee', () => {
    const oldFee = fee
    const newFee = '20000' // 20% fee

    beforeEach(async () => {
      await rentals.connect(deployer).initialize(owner.address, deployer.address, collector.address, oldFee)
    })

    it('should update the fee variable', async () => {
      await rentals.connect(owner).setFee(newFee)
      expect(await rentals.fee()).to.be.equal(newFee)
    })

    it('should emit a FeeUpdated event', async () => {
      await expect(rentals.connect(owner).setFee(newFee)).to.emit(rentals, 'FeeUpdated').withArgs(oldFee, newFee, owner.address)
    })

    it('should accept the maximum fee of 1_000_000', async () => {
      const maximumFee = '1000000'
      await rentals.connect(owner).setFee(maximumFee)
      expect(await rentals.fee()).to.be.equal(maximumFee)
    })

    it('should accept a meta tx', async () => {
      const abi = ['function setFee(uint256 _fee)']
      const iface = new ethers.utils.Interface(abi)
      const functionData = iface.encodeFunctionData('setFee', [newFee])
      const metaTxSignature = await getMetaTxSignature(owner, rentals, functionData)

      await rentals.connect(owner).executeMetaTransaction(owner.address, functionData, metaTxSignature)

      expect(await rentals.fee()).to.be.equal(newFee)
    })

    it('should revert when sender is not owner', async () => {
      await expect(rentals.connect(tenant).setFee(newFee)).to.be.revertedWith('Ownable: caller is not the owner')
    })

    it('should revert when fee is higher than 1_000_000', async () => {
      const invalidFee = '1000001'
      await expect(rentals.connect(owner).setFee(invalidFee)).to.be.revertedWith('Rentals#_setFee: HIGHER_THAN_1000000')
    })
  })

  describe('bumpContractNonce', () => {
    beforeEach(async () => {
      await rentals.connect(deployer).initialize(owner.address, mana.address, collector.address, fee)
    })

    it('should increase the contractNonce by 1', async () => {
      expect(await rentals.connect(owner).contractNonce()).to.equal(0)
      await rentals.connect(owner).bumpContractNonce()
      expect(await rentals.connect(owner).contractNonce()).to.equal(1)
    })

    it('should emit a ContractNonceUpdated event', async () => {
      await expect(rentals.connect(owner).bumpContractNonce()).to.emit(rentals, 'ContractNonceUpdated').withArgs(0, 1, owner.address)
    })

    it('should accept a meta tx', async () => {
      const abi = ['function bumpContractNonce()']
      const iface = new ethers.utils.Interface(abi)
      const functionData = iface.encodeFunctionData('bumpContractNonce', [])
      const metaTxSignature = await getMetaTxSignature(owner, rentals, functionData)

      expect(await rentals.connect(owner).contractNonce()).to.equal(0)
      await rentals.connect(owner).executeMetaTransaction(owner.address, functionData, metaTxSignature)
      expect(await rentals.connect(owner).contractNonce()).to.equal(1)
    })

    it('should revert when the contract owner is not the caller', async () => {
      await expect(rentals.connect(tenant).bumpContractNonce()).to.be.revertedWith('Ownable: caller is not the owner')
    })
  })

  describe('bumpSignerNonce', () => {
    beforeEach(async () => {
      await rentals.connect(deployer).initialize(owner.address, mana.address, collector.address, fee)
    })

    it('should increase the signerNonce for the sender by 1', async () => {
      expect(await rentals.connect(lessor).signerNonce(lessor.address)).to.equal(0)
      await rentals.connect(lessor).bumpSignerNonce()
      expect(await rentals.connect(lessor).signerNonce(lessor.address)).to.equal(1)
    })

    it('should emit an SignerNonceUpdated event', async () => {
      await expect(rentals.connect(lessor).bumpSignerNonce()).to.emit(rentals, 'SignerNonceUpdated').withArgs(0, 1, lessor.address, lessor.address)
    })

    it('should accept a meta tx', async () => {
      const abi = ['function bumpSignerNonce()']
      const iface = new ethers.utils.Interface(abi)
      const functionData = iface.encodeFunctionData('bumpSignerNonce', [])
      const metaTxSignature = await getMetaTxSignature(lessor, rentals, functionData)

      expect(await rentals.connect(lessor).signerNonce(lessor.address)).to.equal(0)
      await rentals.connect(lessor).executeMetaTransaction(lessor.address, functionData, metaTxSignature)
      expect(await rentals.connect(lessor).signerNonce(lessor.address)).to.equal(1)
    })
  })

  describe('bumpAssetNonce', () => {
    beforeEach(async () => {
      await rentals.connect(deployer).initialize(owner.address, mana.address, collector.address, fee)
    })

    it('should increase the assetNonce for the sender by 1', async () => {
      expect(await rentals.connect(lessor).assetNonce(land.address, tokenId, lessor.address)).to.equal(0)
      await rentals.connect(lessor).bumpAssetNonce(land.address, tokenId)
      expect(await rentals.connect(lessor).assetNonce(land.address, tokenId, lessor.address)).to.equal(1)
    })

    it('should emit an AssetNonceUpdated event', async () => {
      await expect(rentals.connect(lessor).bumpAssetNonce(land.address, tokenId))
        .to.emit(rentals, 'AssetNonceUpdated')
        .withArgs(0, 1, land.address, tokenId, lessor.address, lessor.address)
    })

    it('should accept a meta tx', async () => {
      const abi = ['function bumpAssetNonce(address _contractAddress, uint256 _tokenId)']
      const iface = new ethers.utils.Interface(abi)
      const functionData = iface.encodeFunctionData('bumpAssetNonce', [land.address, tokenId])
      const metaTxSignature = await getMetaTxSignature(lessor, rentals, functionData)

      expect(await rentals.connect(lessor).assetNonce(land.address, tokenId, lessor.address)).to.equal(0)
      await rentals.connect(lessor).executeMetaTransaction(lessor.address, functionData, metaTxSignature)
      expect(await rentals.connect(lessor).assetNonce(land.address, tokenId, lessor.address)).to.equal(1)
    })
  })

  describe('isRented', () => {
    beforeEach(async () => {
      await rentals.connect(deployer).initialize(owner.address, mana.address, collector.address, fee)
    })

    it('should return false when the asset was never rented', async () => {
      expect(await rentals.isRented(land.address, tokenId)).to.equal(false)
    })

    it('should return true after an asset is rented', async () => {
      await rentals.connect(lessor).acceptOffer({ ...offerParams, signature: await getOfferSignature(tenant, rentals, offerParams) })

      expect(await rentals.isRented(land.address, tokenId)).to.equal(true)
    })

    it('should return true when the current block timestamp is the same as the rental end', async () => {
      await rentals.connect(lessor).acceptOffer({ ...offerParams, signature: await getOfferSignature(tenant, rentals, offerParams) })

      await evmIncreaseTime(daysToSeconds(offerParams.rentalDays))
      await evmMine()

      const latestBlockTimestamp = await getLatestBlockTimestamp()
      const rentalEnd = (await rentals.rentals(land.address, tokenId)).endDate

      expect(rentalEnd).to.be.equal(latestBlockTimestamp)

      expect(await rentals.isRented(land.address, tokenId)).to.equal(true)
    })

    it('should return false when the block timestamp is equal to the rental end + 1', async () => {
      await rentals.connect(lessor).acceptOffer({ ...offerParams, signature: await getOfferSignature(tenant, rentals, offerParams) })

      await evmIncreaseTime(daysToSeconds(offerParams.rentalDays) + 1)
      await evmMine()

      expect(await rentals.isRented(land.address, tokenId)).to.equal(false)
    })
  })

  describe('acceptListing', () => {
    beforeEach(async () => {
      await rentals.connect(deployer).initialize(owner.address, mana.address, collector.address, fee)
    })

    it('should emit a RentalStarted event', async () => {
      await expect(
        rentals
          .connect(tenant)
          .acceptListing(
            { ...listingParams, signature: await getListingSignature(lessor, rentals, listingParams) },
            acceptListingParams.operator,
            acceptListingParams.index,
            acceptListingParams.rentalDays,
            acceptListingParams.fingerprint
          )
      )
        .to.emit(rentals, 'RentalStarted')
        .withArgs(
          offerParams.contractAddress,
          offerParams.tokenId,
          listingParams.signer,
          offerParams.signer,
          offerParams.operator,
          offerParams.rentalDays,
          offerParams.pricePerDay,
          tenant.address
        )
    })

    it('should emit an AssetNonceUpdated event for the lessor and the tenant', async () => {
      await expect(
        rentals
          .connect(tenant)
          .acceptListing(
            { ...listingParams, signature: await getListingSignature(lessor, rentals, listingParams) },
            acceptListingParams.operator,
            acceptListingParams.index,
            acceptListingParams.rentalDays,
            acceptListingParams.fingerprint
          )
      )
        .to.emit(rentals, 'AssetNonceUpdated')
        .withArgs(0, 1, listingParams.contractAddress, listingParams.tokenId, listingParams.signer, tenant.address)
        .to.emit(rentals, 'AssetNonceUpdated')
        .withArgs(0, 1, offerParams.contractAddress, offerParams.tokenId, offerParams.signer, tenant.address)
    })

    it('should allow the tenant to select a different option included in the tenant signature by providing a different index', async () => {
      listingParams.pricePerDay = [...listingParams.pricePerDay, ether('20')]
      listingParams.maxDays = [...listingParams.maxDays, 30]
      listingParams.minDays = [...listingParams.minDays, 20]

      offerParams.pricePerDay = ether('20')
      offerParams.rentalDays = 25

      const index = 1

      const rent = rentals
        .connect(tenant)
        .acceptListing(
          { ...listingParams, signature: await getListingSignature(lessor, rentals, listingParams) },
          offerParams.operator,
          index,
          offerParams.rentalDays,
          offerParams.fingerprint
        )

      await expect(rent)
        .to.emit(rentals, 'RentalStarted')
        .withArgs(
          offerParams.contractAddress,
          offerParams.tokenId,
          listingParams.signer,
          offerParams.signer,
          offerParams.operator,
          offerParams.rentalDays,
          offerParams.pricePerDay,
          tenant.address
        )
    })

    it('should update the rentals mapping with lessor when the contract does not own the asset already', async () => {
      expect((await rentals.rentals(land.address, tokenId)).lessor).to.equal(zeroAddress)

      await rentals
        .connect(tenant)
        .acceptListing(
          { ...listingParams, signature: await getListingSignature(lessor, rentals, listingParams) },
          acceptListingParams.operator,
          acceptListingParams.index,
          acceptListingParams.rentalDays,
          acceptListingParams.fingerprint
        )

      expect((await rentals.rentals(land.address, tokenId)).lessor).to.equal(lessor.address)
    })

    it('should update the rentals mapping with new tenant', async () => {
      expect((await rentals.rentals(land.address, tokenId)).tenant).to.equal(zeroAddress)

      await rentals
        .connect(tenant)
        .acceptListing(
          { ...listingParams, signature: await getListingSignature(lessor, rentals, listingParams) },
          acceptListingParams.operator,
          acceptListingParams.index,
          acceptListingParams.rentalDays,
          acceptListingParams.fingerprint
        )

      expect((await rentals.rentals(land.address, tokenId)).tenant).to.equal(tenant.address)
    })

    it('should bump both the lessor and tenant asset nonces', async () => {
      expect(await rentals.connect(lessor).assetNonce(land.address, tokenId, lessor.address)).to.equal(0)
      expect(await rentals.connect(lessor).assetNonce(land.address, tokenId, tenant.address)).to.equal(0)

      await rentals
        .connect(tenant)
        .acceptListing(
          { ...listingParams, signature: await getListingSignature(lessor, rentals, listingParams) },
          acceptListingParams.operator,
          acceptListingParams.index,
          acceptListingParams.rentalDays,
          acceptListingParams.fingerprint
        )

      expect(await rentals.connect(lessor).assetNonce(land.address, tokenId, lessor.address)).to.equal(1)
      expect(await rentals.connect(lessor).assetNonce(land.address, tokenId, tenant.address)).to.equal(1)
    })

    it('should update the rentals mapping with the end timestamp of the rented asset', async () => {
      expect((await rentals.rentals(land.address, tokenId)).endDate).to.equal(0)

      const latestBlockTimestamp = await getLatestBlockTimestamp()

      await rentals
        .connect(tenant)
        .acceptListing(
          { ...listingParams, signature: await getListingSignature(lessor, rentals, listingParams) },
          acceptListingParams.operator,
          acceptListingParams.index,
          acceptListingParams.rentalDays,
          acceptListingParams.fingerprint
        )

      expect((await rentals.rentals(land.address, tokenId)).endDate).to.equal(latestBlockTimestamp + daysToSeconds(offerParams.rentalDays) + 1)
    })

    it('should not transfer erc20 when price per day is 0', async () => {
      const originalBalanceTenant = await mana.balanceOf(tenant.address)
      const originalBalanceLessor = await mana.balanceOf(lessor.address)
      const originalBalanceCollector = await mana.balanceOf(collector.address)

      listingParams.pricePerDay = ['0']
      offerParams.pricePerDay = '0'

      await rentals
        .connect(tenant)
        .acceptListing(
          { ...listingParams, signature: await getListingSignature(lessor, rentals, listingParams) },
          acceptListingParams.operator,
          acceptListingParams.index,
          acceptListingParams.rentalDays,
          acceptListingParams.fingerprint
        )

      expect(await mana.balanceOf(tenant.address)).to.equal(originalBalanceTenant)
      expect(await mana.balanceOf(lessor.address)).to.equal(originalBalanceLessor)
      expect(await mana.balanceOf(collector.address)).to.equal(originalBalanceCollector)
    })

    it('should transfer erc20 from the tenant to the lessor and collector', async () => {
      const originalBalanceTenant = await mana.balanceOf(tenant.address)
      const originalBalanceLessor = await mana.balanceOf(lessor.address)
      const originalBalanceCollector = await mana.balanceOf(collector.address)

      await rentals
        .connect(tenant)
        .acceptListing(
          { ...listingParams, signature: await getListingSignature(lessor, rentals, listingParams) },
          acceptListingParams.operator,
          acceptListingParams.index,
          acceptListingParams.rentalDays,
          acceptListingParams.fingerprint
        )

      const total = BigNumber.from(offerParams.pricePerDay).mul(offerParams.rentalDays)
      const forCollector = total.mul(BigNumber.from(fee)).div(BigNumber.from(1000000))
      const forLessor = total.sub(forCollector)

      expect(await mana.balanceOf(tenant.address)).to.equal(originalBalanceTenant.sub(total))
      expect(await mana.balanceOf(lessor.address)).to.equal(originalBalanceLessor.add(forLessor))
      expect(await mana.balanceOf(collector.address)).to.equal(originalBalanceCollector.add(forCollector))
    })

    it('should not transfer erc20 to collector when fee is 0', async () => {
      const originalBalanceTenant = await mana.balanceOf(tenant.address)
      const originalBalanceLessor = await mana.balanceOf(lessor.address)
      const originalBalanceCollector = await mana.balanceOf(collector.address)

      await rentals.connect(owner).setFee('0')

      await rentals
        .connect(tenant)
        .acceptListing(
          { ...listingParams, signature: await getListingSignature(lessor, rentals, listingParams) },
          acceptListingParams.operator,
          acceptListingParams.index,
          acceptListingParams.rentalDays,
          acceptListingParams.fingerprint
        )

      const total = BigNumber.from(offerParams.pricePerDay).mul(offerParams.rentalDays)

      expect(await mana.balanceOf(tenant.address)).to.equal(originalBalanceTenant.sub(total))
      expect(await mana.balanceOf(lessor.address)).to.equal(originalBalanceLessor.add(total))
      expect(await mana.balanceOf(collector.address)).to.equal(originalBalanceCollector)
    })

    it('should not transfer erc20 to lessor when fee is 1_000_000', async () => {
      const originalBalanceTenant = await mana.balanceOf(tenant.address)
      const originalBalanceLessor = await mana.balanceOf(lessor.address)
      const originalBalanceCollector = await mana.balanceOf(collector.address)

      await rentals.connect(owner).setFee('1000000')

      await rentals
        .connect(tenant)
        .acceptListing(
          { ...listingParams, signature: await getListingSignature(lessor, rentals, listingParams) },
          acceptListingParams.operator,
          acceptListingParams.index,
          acceptListingParams.rentalDays,
          acceptListingParams.fingerprint
        )

      const total = BigNumber.from(offerParams.pricePerDay).mul(offerParams.rentalDays)

      expect(await mana.balanceOf(tenant.address)).to.equal(originalBalanceTenant.sub(total))
      expect(await mana.balanceOf(lessor.address)).to.equal(originalBalanceLessor)
      expect(await mana.balanceOf(collector.address)).to.equal(originalBalanceCollector.add(total))
    })

    it('should accept a meta tx', async () => {
      const abi = [
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

      const iface = new ethers.utils.Interface(abi)
      const functionData = iface.encodeFunctionData('acceptListing', [
        { ...listingParams, signature: await getListingSignature(lessor, rentals, listingParams) },
        acceptListingParams.operator,
        acceptListingParams.index,
        acceptListingParams.rentalDays,
        acceptListingParams.fingerprint,
      ])
      const metaTxSignature = await getMetaTxSignature(tenant, rentals, functionData)

      const rent = rentals.connect(extra).executeMetaTransaction(tenant.address, functionData, metaTxSignature)

      await expect(rent)
        .to.emit(rentals, 'RentalStarted')
        .withArgs(
          offerParams.contractAddress,
          offerParams.tokenId,
          listingParams.signer,
          offerParams.signer,
          offerParams.operator,
          offerParams.rentalDays,
          offerParams.pricePerDay,
          tenant.address
        )
    })

    it('should revert when lessor is same as tenant', async () => {
      listingParams = { ...listingParams, signer: lessor.address }

      await expect(
        rentals
          .connect(lessor)
          .acceptListing(
            { ...listingParams, signature: await getListingSignature(lessor, rentals, listingParams) },
            acceptListingParams.operator,
            acceptListingParams.index,
            acceptListingParams.rentalDays,
            acceptListingParams.fingerprint
          )
      ).to.be.revertedWith('Rentals#acceptListing: CALLER_CANNOT_BE_SIGNER')
    })

    it('should revert when the lessor signer does not match the signer in params', async () => {
      await expect(
        rentals
          .connect(tenant)
          .acceptListing(
            { ...listingParams, signature: await getListingSignature(lessor, rentals, { ...listingParams, signer: tenant.address }) },
            acceptListingParams.operator,
            acceptListingParams.index,
            acceptListingParams.rentalDays,
            acceptListingParams.fingerprint
          )
      ).to.be.revertedWith('Rentals#acceptListing: SIGNATURE_MISSMATCH')
    })

    it('should revert when pricePerDay maxDays and minDays length is 0', async () => {
      listingParams.pricePerDay = []
      listingParams.maxDays = []
      listingParams.minDays = []

      await expect(
        rentals
          .connect(tenant)
          .acceptListing(
            { ...listingParams, signature: await getListingSignature(lessor, rentals, listingParams) },
            acceptListingParams.operator,
            acceptListingParams.index,
            acceptListingParams.rentalDays,
            acceptListingParams.fingerprint
          )
      ).to.be.revertedWith('Rentals#acceptListing: INDEX_OUT_OF_BOUNDS')
    })

    it('should revert when maxDays length is different than pricePerDay length', async () => {
      listingParams.maxDays = [10, 20]

      await expect(
        rentals
          .connect(tenant)
          .acceptListing(
            { ...listingParams, signature: await getListingSignature(lessor, rentals, listingParams) },
            acceptListingParams.operator,
            acceptListingParams.index,
            acceptListingParams.rentalDays,
            acceptListingParams.fingerprint
          )
      ).to.be.revertedWith('Rentals#acceptListing: MAX_DAYS_LENGTH_MISSMATCH')
    })

    it('should revert when minDays length is different than pricePerDay length', async () => {
      listingParams.minDays = [10, 20]

      await expect(
        rentals
          .connect(tenant)
          .acceptListing(
            { ...listingParams, signature: await getListingSignature(lessor, rentals, listingParams) },
            acceptListingParams.operator,
            acceptListingParams.index,
            acceptListingParams.rentalDays,
            acceptListingParams.fingerprint
          )
      ).to.be.revertedWith('Rentals#acceptListing: MIN_DAYS_LENGTH_MISSMATCH')
    })

    it('should revert when tenant index is outside the pricePerDay length', async () => {
      acceptListingParams = { ...acceptListingParams, index: 1 }

      await expect(
        rentals
          .connect(tenant)
          .acceptListing(
            { ...listingParams, signature: await getListingSignature(lessor, rentals, listingParams) },
            acceptListingParams.operator,
            acceptListingParams.index,
            acceptListingParams.rentalDays,
            acceptListingParams.fingerprint
          )
      ).to.be.revertedWith('Rentals#acceptListing: INDEX_OUT_OF_BOUNDS')
    })

    it('should revert when the block timestamp is higher than the provided lessor signature expiration', async () => {
      listingParams = { ...listingParams, expiration: now() - 1000 }

      await expect(
        rentals
          .connect(tenant)
          .acceptListing(
            { ...listingParams, signature: await getListingSignature(lessor, rentals, listingParams) },
            acceptListingParams.operator,
            acceptListingParams.index,
            acceptListingParams.rentalDays,
            acceptListingParams.fingerprint
          )
      ).to.be.revertedWith('Rentals#acceptListing: EXPIRED_SIGNATURE')
    })

    it('should revert when max days is lower than min days', async () => {
      listingParams = { ...listingParams, minDays: [BigNumber.from(listingParams.maxDays[0]).add(1)] }

      await expect(
        rentals
          .connect(tenant)
          .acceptListing(
            { ...listingParams, signature: await getListingSignature(lessor, rentals, listingParams) },
            acceptListingParams.operator,
            acceptListingParams.index,
            acceptListingParams.rentalDays,
            acceptListingParams.fingerprint
          )
      ).to.be.revertedWith('Rentals#acceptListing: MAX_DAYS_LOWER_THAN_MIN_DAYS')
    })

    it('should revert when min days is 0', async () => {
      listingParams = { ...listingParams, minDays: [0] }

      await expect(
        rentals
          .connect(tenant)
          .acceptListing(
            { ...listingParams, signature: await getListingSignature(lessor, rentals, listingParams) },
            acceptListingParams.operator,
            acceptListingParams.index,
            acceptListingParams.rentalDays,
            acceptListingParams.fingerprint
          )
      ).to.be.revertedWith('Rentals#acceptListing: MIN_DAYS_IS_ZERO')
    })

    it('should revert when tenant days is lower than lessor min days', async () => {
      acceptListingParams = { ...acceptListingParams, rentalDays: BigNumber.from(listingParams.minDays[0]).sub(1) }

      await expect(
        rentals
          .connect(tenant)
          .acceptListing(
            { ...listingParams, signature: await getListingSignature(lessor, rentals, listingParams) },
            acceptListingParams.operator,
            acceptListingParams.index,
            acceptListingParams.rentalDays,
            acceptListingParams.fingerprint
          )
      ).to.be.revertedWith('Rentals#acceptListing: DAYS_NOT_IN_RANGE')
    })

    it('should revert when tenant days is higher than lessor max days', async () => {
      acceptListingParams = { ...acceptListingParams, rentalDays: BigNumber.from(listingParams.maxDays[0]).add(1) }

      await expect(
        rentals
          .connect(tenant)
          .acceptListing(
            { ...listingParams, signature: await getListingSignature(lessor, rentals, listingParams) },
            acceptListingParams.operator,
            acceptListingParams.index,
            acceptListingParams.rentalDays,
            acceptListingParams.fingerprint
          )
      ).to.be.revertedWith('Rentals#acceptListing: DAYS_NOT_IN_RANGE')
    })

    it('should revert when lessor contract nonce is not the same as the contract', async () => {
      listingParams = { ...listingParams, nonces: [1, 0, 0] }

      await expect(
        rentals
          .connect(tenant)
          .acceptListing(
            { ...listingParams, signature: await getListingSignature(lessor, rentals, listingParams) },
            acceptListingParams.operator,
            acceptListingParams.index,
            acceptListingParams.rentalDays,
            acceptListingParams.fingerprint
          )
      ).to.be.revertedWith('NonceVerifiable#_verifyContractNonce: CONTRACT_NONCE_MISSMATCH')
    })

    it('should revert when lessor signer nonce is not the same as the contract', async () => {
      listingParams = { ...listingParams, nonces: [0, 1, 0] }

      await expect(
        rentals
          .connect(tenant)
          .acceptListing(
            { ...listingParams, signature: await getListingSignature(lessor, rentals, listingParams) },
            acceptListingParams.operator,
            acceptListingParams.index,
            acceptListingParams.rentalDays,
            acceptListingParams.fingerprint
          )
      ).to.be.revertedWith('NonceVerifiable#_verifySignerNonce: SIGNER_NONCE_MISSMATCH')
    })

    it('should revert when lessor asset nonce is not the same as the contract', async () => {
      listingParams = { ...listingParams, nonces: [0, 0, 1] }

      await expect(
        rentals
          .connect(tenant)
          .acceptListing(
            { ...listingParams, signature: await getListingSignature(lessor, rentals, listingParams) },
            acceptListingParams.operator,
            acceptListingParams.index,
            acceptListingParams.rentalDays,
            acceptListingParams.fingerprint
          )
      ).to.be.revertedWith('NonceVerifiable#_verifyAssetNonce: ASSET_NONCE_MISSMATCH')
    })

    it("should revert when the provided contract address's `verifyFingerprint` returns false", async () => {
      listingParams = { ...listingParams, contractAddress: estate.address, tokenId: estateId }

      await expect(
        rentals
          .connect(tenant)
          .acceptListing(
            { ...listingParams, signature: await getListingSignature(lessor, rentals, listingParams) },
            acceptListingParams.operator,
            acceptListingParams.index,
            acceptListingParams.rentalDays,
            acceptListingParams.fingerprint
          )
      ).to.be.revertedWith('Rentals#_rent: INVALID_FINGERPRINT')
    })

    it("should NOT revert when the provided contract address's `verifyFingerprint` returns true", async () => {
      listingParams = { ...listingParams, contractAddress: estate.address, tokenId: estateId }
      acceptListingParams = { ...acceptListingParams, fingerprint: await estate.connect(tenant).getFingerprint(estateId) }

      await rentals
        .connect(tenant)
        .acceptListing(
          { ...listingParams, signature: await getListingSignature(lessor, rentals, listingParams) },
          acceptListingParams.operator,
          acceptListingParams.index,
          acceptListingParams.rentalDays,
          acceptListingParams.fingerprint
        )
    })

    it('should revert if an asset is already being rented', async () => {
      rentals
        .connect(tenant)
        .acceptListing(
          { ...listingParams, signature: await getListingSignature(lessor, rentals, listingParams) },
          acceptListingParams.operator,
          acceptListingParams.index,
          acceptListingParams.rentalDays,
          acceptListingParams.fingerprint
        )

      listingParams = { ...listingParams, nonces: [0, 0, 1] }

      await expect(
        rentals
          .connect(tenant)
          .acceptListing(
            { ...listingParams, signature: await getListingSignature(lessor, rentals, listingParams) },
            acceptListingParams.operator,
            acceptListingParams.index,
            acceptListingParams.rentalDays,
            acceptListingParams.fingerprint
          )
      ).to.be.revertedWith('Rentals#_rent: CURRENTLY_RENTED')
    })

    it('should revert if someone other than the original owner wants to rent an asset currently owned by the contract', async () => {
      await rentals
        .connect(tenant)
        .acceptListing(
          { ...listingParams, signature: await getListingSignature(lessor, rentals, listingParams) },
          acceptListingParams.operator,
          acceptListingParams.index,
          acceptListingParams.rentalDays,
          acceptListingParams.fingerprint
        )

      await evmIncreaseTime(daysToSeconds(acceptListingParams.rentalDays))
      await evmMine()

      listingParams = { ...listingParams, signer: extra.address, expiration: maxUint256 }

      await expect(
        rentals
          .connect(tenant)
          .acceptListing(
            { ...listingParams, signature: await getListingSignature(extra, rentals, listingParams) },
            acceptListingParams.operator,
            acceptListingParams.index,
            acceptListingParams.rentalDays,
            acceptListingParams.fingerprint
          )
      ).to.be.revertedWith('Rentals#_rent: NOT_ORIGINAL_OWNER')
    })

    it('should revert with currently rented error when claim is sent in the same block as accept listing', async () => {
      // Disable automine so the transactions are included in the same block.
      await network.provider.send('evm_setAutomine', [false])

      await rentals
        .connect(tenant)
        .acceptListing(
          { ...listingParams, signature: await getListingSignature(lessor, rentals, listingParams) },
          acceptListingParams.operator,
          acceptListingParams.index,
          acceptListingParams.rentalDays,
          acceptListingParams.fingerprint
        )

      await rentals.connect(lessor).claim(listingParams.contractAddress, listingParams.tokenId)

      const pendingBlock = await network.provider.send('eth_getBlockByNumber', ['pending', false])
      expect(pendingBlock.transactions.length).to.be.equal(2)

      await evmMine()

      // Restore automine so tests continue working as always.
      await network.provider.send('evm_setAutomine', [true])

      const latestBlock = await network.provider.send('eth_getBlockByNumber', ['latest', false])

      const claimTrxHash = latestBlock.transactions[1]
      const claimTrxTrace = await network.provider.send('debug_traceTransaction', [claimTrxHash])
      const encodedErrorMessage = `0x${claimTrxTrace.returnValue.substr(136)}`.replace(/0+$/, '')
      const decodedErrorMessage = ethers.utils.toUtf8String(encodedErrorMessage)

      expect(decodedErrorMessage).to.be.equal('Rentals#claim: CURRENTLY_RENTED')
    })

    it('should revert when someone tries to accept a listing for an asset sent to the contract unsafely', async () => {
      await land.connect(lessor).transferFrom(lessor.address, rentals.address, tokenId)

      listingParams = { ...listingParams, signer: extra.address }

      await expect(
        rentals
          .connect(tenant)
          .acceptListing(
            { ...listingParams, signature: await getListingSignature(extra, rentals, listingParams) },
            acceptListingParams.operator,
            acceptListingParams.index,
            acceptListingParams.rentalDays,
            acceptListingParams.fingerprint
          )
      ).to.be.revertedWith('Rentals#_verifyUnsafeTransfer: ASSET_TRANSFERRED_UNSAFELY')
    })

    it('should revert when the caller is different from the target provided in the listing', async () => {
      listingParams = { ...listingParams, target: extra.address }

      await expect(
        rentals
          .connect(tenant)
          .acceptListing(
            { ...listingParams, signature: await getListingSignature(lessor, rentals, listingParams) },
            acceptListingParams.operator,
            acceptListingParams.index,
            acceptListingParams.rentalDays,
            acceptListingParams.fingerprint
          )
      ).to.be.revertedWith('Rentals#acceptListing: TARGET_MISMATCH')
    })

    it('should NOT revert when the caller is the same as the one target provided in the listing', async () => {
      listingParams = { ...listingParams, target: tenant.address }

      expect((await rentals.rentals(listingParams.contractAddress, listingParams.tokenId)).tenant).to.equal(zeroAddress)

      await rentals
        .connect(tenant)
        .acceptListing(
          { ...listingParams, signature: await getListingSignature(lessor, rentals, listingParams) },
          acceptListingParams.operator,
          acceptListingParams.index,
          acceptListingParams.rentalDays,
          acceptListingParams.fingerprint
        )

      expect((await rentals.rentals(listingParams.contractAddress, listingParams.tokenId)).tenant).to.equal(tenant.address)
    })
  })

  describe('acceptOffer', () => {
    beforeEach(async () => {
      await rentals.connect(deployer).initialize(owner.address, mana.address, collector.address, fee)
    })

    it('should emit a RentalStarted event', async () => {
      await expect(rentals.connect(lessor).acceptOffer({ ...offerParams, signature: await getOfferSignature(tenant, rentals, offerParams) }))
        .to.emit(rentals, 'RentalStarted')
        .withArgs(
          offerParams.contractAddress,
          offerParams.tokenId,
          listingParams.signer,
          offerParams.signer,
          offerParams.operator,
          offerParams.rentalDays,
          offerParams.pricePerDay,
          lessor.address
        )
    })

    it('should emit an AssetNonceUpdated event for the lessor and the tenant', async () => {
      await expect(rentals.connect(lessor).acceptOffer({ ...offerParams, signature: await getOfferSignature(tenant, rentals, offerParams) }))
        .to.emit(rentals, 'AssetNonceUpdated')
        .withArgs(0, 1, listingParams.contractAddress, listingParams.tokenId, listingParams.signer, lessor.address)
        .to.emit(rentals, 'AssetNonceUpdated')
        .withArgs(0, 1, offerParams.contractAddress, offerParams.tokenId, offerParams.signer, lessor.address)
    })

    it('should update rentals mapping with lessor when the contract does not own the asset already', async () => {
      expect((await rentals.rentals(land.address, tokenId)).lessor).to.equal(zeroAddress)

      await rentals.connect(lessor).acceptOffer({ ...offerParams, signature: await getOfferSignature(tenant, rentals, offerParams) })

      expect((await rentals.rentals(land.address, tokenId)).lessor).to.equal(lessor.address)
    })

    it('should update the rentals mapping with new tenant', async () => {
      expect((await rentals.rentals(land.address, tokenId)).tenant).to.equal(zeroAddress)

      await rentals.connect(lessor).acceptOffer({ ...offerParams, signature: await getOfferSignature(tenant, rentals, offerParams) })

      expect((await rentals.rentals(land.address, tokenId)).tenant).to.equal(tenant.address)
    })

    it('should bump both the lessor and tenant asset nonces', async () => {
      expect(await rentals.connect(lessor).assetNonce(land.address, tokenId, lessor.address)).to.equal(0)
      expect(await rentals.connect(lessor).assetNonce(land.address, tokenId, tenant.address)).to.equal(0)

      await rentals.connect(lessor).acceptOffer({ ...offerParams, signature: await getOfferSignature(tenant, rentals, offerParams) })

      expect(await rentals.connect(lessor).assetNonce(land.address, tokenId, lessor.address)).to.equal(1)
      expect(await rentals.connect(lessor).assetNonce(land.address, tokenId, tenant.address)).to.equal(1)
    })

    it('should update the rentals mapping for the rented asset with the rental finish timestamp', async () => {
      expect((await rentals.rentals(land.address, tokenId)).endDate).to.equal(0)

      const latestBlockTimestamp = await getLatestBlockTimestamp()

      await rentals.connect(lessor).acceptOffer({ ...offerParams, signature: await getOfferSignature(tenant, rentals, offerParams) })

      expect((await rentals.rentals(land.address, tokenId)).endDate).to.equal(latestBlockTimestamp + daysToSeconds(offerParams.rentalDays) + 1)
    })

    it('should not transfer erc20 when price per day is 0', async () => {
      const originalBalanceTenant = await mana.balanceOf(tenant.address)
      const originalBalanceLessor = await mana.balanceOf(lessor.address)
      const originalBalanceCollector = await mana.balanceOf(collector.address)

      offerParams.pricePerDay = '0'

      await rentals.connect(lessor).acceptOffer({ ...offerParams, signature: await getOfferSignature(tenant, rentals, offerParams) })

      expect(await mana.balanceOf(tenant.address)).to.equal(originalBalanceTenant)
      expect(await mana.balanceOf(lessor.address)).to.equal(originalBalanceLessor)
      expect(await mana.balanceOf(collector.address)).to.equal(originalBalanceCollector)
    })

    it('should transfer erc20 from the tenant to the lessor and collector', async () => {
      const originalBalanceTenant = await mana.balanceOf(tenant.address)
      const originalBalanceLessor = await mana.balanceOf(lessor.address)
      const originalBalanceCollector = await mana.balanceOf(collector.address)

      await rentals.connect(lessor).acceptOffer({ ...offerParams, signature: await getOfferSignature(tenant, rentals, offerParams) })

      const total = BigNumber.from(offerParams.pricePerDay).mul(offerParams.rentalDays)
      const forCollector = total.mul(BigNumber.from(fee)).div(BigNumber.from(1000000))
      const forLessor = total.sub(forCollector)

      expect(await mana.balanceOf(tenant.address)).to.equal(originalBalanceTenant.sub(total))
      expect(await mana.balanceOf(lessor.address)).to.equal(originalBalanceLessor.add(forLessor))
      expect(await mana.balanceOf(collector.address)).to.equal(originalBalanceCollector.add(forCollector))
    })

    it('should not transfer erc20 to collector when fee is 0', async () => {
      const originalBalanceTenant = await mana.balanceOf(tenant.address)
      const originalBalanceLessor = await mana.balanceOf(lessor.address)
      const originalBalanceCollector = await mana.balanceOf(collector.address)

      await rentals.connect(owner).setFee('0')

      await rentals.connect(lessor).acceptOffer({ ...offerParams, signature: await getOfferSignature(tenant, rentals, offerParams) })

      const total = BigNumber.from(offerParams.pricePerDay).mul(offerParams.rentalDays)

      expect(await mana.balanceOf(tenant.address)).to.equal(originalBalanceTenant.sub(total))
      expect(await mana.balanceOf(lessor.address)).to.equal(originalBalanceLessor.add(total))
      expect(await mana.balanceOf(collector.address)).to.equal(originalBalanceCollector)
    })

    it('should not transfer erc20 to lessor when fee is 1_000_000', async () => {
      const originalBalanceTenant = await mana.balanceOf(tenant.address)
      const originalBalanceLessor = await mana.balanceOf(lessor.address)
      const originalBalanceCollector = await mana.balanceOf(collector.address)

      await rentals.connect(owner).setFee('1000000')

      await rentals.connect(lessor).acceptOffer({ ...offerParams, signature: await getOfferSignature(tenant, rentals, offerParams) })

      const total = BigNumber.from(offerParams.pricePerDay).mul(offerParams.rentalDays)

      expect(await mana.balanceOf(tenant.address)).to.equal(originalBalanceTenant.sub(total))
      expect(await mana.balanceOf(lessor.address)).to.equal(originalBalanceLessor)
      expect(await mana.balanceOf(collector.address)).to.equal(originalBalanceCollector.add(total))
    })

    it('should accept a meta tx', async () => {
      const abi = [
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

      const iface = new ethers.utils.Interface(abi)
      const functionData = iface.encodeFunctionData('acceptOffer', [
        { ...offerParams, signature: await getOfferSignature(tenant, rentals, offerParams) },
      ])
      const metaTxSignature = await getMetaTxSignature(lessor, rentals, functionData)

      const rent = rentals.connect(lessor).executeMetaTransaction(lessor.address, functionData, metaTxSignature)

      await expect(rent)
        .to.emit(rentals, 'RentalStarted')
        .withArgs(
          offerParams.contractAddress,
          offerParams.tokenId,
          listingParams.signer,
          offerParams.signer,
          offerParams.operator,
          offerParams.rentalDays,
          offerParams.pricePerDay,
          lessor.address
        )
    })

    it('should revert when the offer signer does not match the signer provided in params', async () => {
      await expect(
        rentals
          .connect(lessor)
          .acceptOffer({ ...offerParams, signature: await getOfferSignature(tenant, rentals, { ...offerParams, signer: lessor.address }) })
      ).to.be.revertedWith('Rentals#acceptOffer: SIGNATURE_MISSMATCH')
    })

    it('should revert when lessor is same as tenant', async () => {
      offerParams = { ...offerParams, signer: lessor.address }

      await expect(
        rentals.connect(lessor).acceptOffer({ ...offerParams, signature: await getOfferSignature(lessor, rentals, offerParams) })
      ).to.be.revertedWith('Rentals#acceptOffer: CALLER_CANNOT_BE_SIGNER')
    })

    it('should revert when the block timestamp is higher than the provided tenant signature expiration', async () => {
      offerParams = { ...offerParams, expiration: now() - 1000 }

      await expect(
        rentals.connect(lessor).acceptOffer({ ...offerParams, signature: await getOfferSignature(tenant, rentals, offerParams) })
      ).to.be.revertedWith('Rentals#acceptOffer: EXPIRED_SIGNATURE')
    })

    it('should revert when tenant rental days is zero', async () => {
      offerParams = { ...offerParams, rentalDays: 0 }

      await expect(
        rentals.connect(lessor).acceptOffer({ ...offerParams, signature: await getOfferSignature(tenant, rentals, offerParams) })
      ).to.be.revertedWith('Rentals#acceptOffer: RENTAL_DAYS_IS_ZERO')
    })

    it('should revert when tenant contract nonce is not the same as the contract', async () => {
      offerParams = { ...offerParams, nonces: [1, 0, 0] }

      await expect(
        rentals.connect(lessor).acceptOffer({ ...offerParams, signature: await getOfferSignature(tenant, rentals, offerParams) })
      ).to.be.revertedWith('NonceVerifiable#_verifyContractNonce: CONTRACT_NONCE_MISSMATCH')
    })

    it('should revert when tenant signer nonce is not the same as the contract', async () => {
      offerParams = { ...offerParams, nonces: [0, 1, 0] }

      await expect(
        rentals.connect(lessor).acceptOffer({ ...offerParams, signature: await getOfferSignature(tenant, rentals, offerParams) })
      ).to.be.revertedWith('NonceVerifiable#_verifySignerNonce: SIGNER_NONCE_MISSMATCH')
    })

    it('should revert when tenant asset nonce is not the same as the contract', async () => {
      offerParams = { ...offerParams, nonces: [0, 0, 1] }

      await expect(
        rentals.connect(lessor).acceptOffer({ ...offerParams, signature: await getOfferSignature(tenant, rentals, offerParams) })
      ).to.be.revertedWith('NonceVerifiable#_verifyAssetNonce: ASSET_NONCE_MISSMATCH')
    })

    it("should revert when the provided contract address's `verifyFingerprint` returns false", async () => {
      offerParams = { ...offerParams, contractAddress: estate.address, tokenId: estateId }

      await expect(
        rentals.connect(lessor).acceptOffer({ ...offerParams, signature: await getOfferSignature(tenant, rentals, offerParams) })
      ).to.be.revertedWith('Rentals#_rent: INVALID_FINGERPRINT')
    })

    it("should NOT revert when the provided contract address's `verifyFingerprint` returns true", async () => {
      offerParams = {
        ...offerParams,
        contractAddress: estate.address,
        tokenId: estateId,
        fingerprint: await estate.connect(tenant).getFingerprint(estateId),
      }

      await rentals.connect(lessor).acceptOffer({ ...offerParams, signature: await getOfferSignature(tenant, rentals, offerParams) })
    })

    it('should revert if an asset is already being rented', async () => {
      rentals.connect(lessor).acceptOffer({ ...offerParams, signature: await getOfferSignature(tenant, rentals, offerParams) })

      listingParams = { ...listingParams, nonces: [0, 0, 1] }
      offerParams = { ...offerParams, nonces: [0, 0, 1] }

      await expect(
        rentals.connect(lessor).acceptOffer({ ...offerParams, signature: await getOfferSignature(tenant, rentals, offerParams) })
      ).to.be.revertedWith('Rentals#_rent: CURRENTLY_RENTED')
    })

    it('should revert if someone other than the original owner wants to rent an asset currently owned by the contract', async () => {
      await rentals.connect(lessor).acceptOffer({ ...offerParams, signature: await getOfferSignature(tenant, rentals, offerParams) })

      await evmIncreaseTime(daysToSeconds(offerParams.rentalDays))
      await evmMine()

      offerParams = { ...offerParams, expiration: maxUint256, nonces: [0, 0, 1] }

      await expect(
        rentals.connect(extra).acceptOffer({ ...offerParams, signature: await getOfferSignature(tenant, rentals, offerParams) })
      ).to.be.revertedWith('Rentals#_rent: NOT_ORIGINAL_OWNER')
    })

    it('should revert when someone tries to accept an offer for an asset sent to the contract unsafely', async () => {
      await land.connect(lessor).transferFrom(lessor.address, rentals.address, tokenId)

      await expect(
        rentals.connect(extra).acceptOffer({ ...offerParams, signature: await getOfferSignature(tenant, rentals, offerParams) })
      ).to.be.revertedWith('Rentals#_verifyUnsafeTransfer: ASSET_TRANSFERRED_UNSAFELY')
    })
  })

  describe('claim', () => {
    beforeEach(async () => {
      await rentals.connect(deployer).initialize(owner.address, mana.address, collector.address, fee)
    })

    it('should set the lessor to address(0)', async () => {
      expect((await rentals.rentals(land.address, tokenId)).lessor).to.equal(zeroAddress)

      await rentals.connect(lessor).acceptOffer({ ...offerParams, signature: await getOfferSignature(tenant, rentals, offerParams) })

      expect((await rentals.rentals(land.address, tokenId)).lessor).to.equal(lessor.address)

      await evmIncreaseTime(daysToSeconds(offerParams.rentalDays))
      await evmMine()

      await rentals.connect(lessor).claim(land.address, tokenId)

      expect((await rentals.rentals(land.address, tokenId)).lessor).to.equal(zeroAddress)
    })

    it('should set tenant to address(0)', async () => {
      expect((await rentals.rentals(land.address, tokenId)).tenant).to.equal(zeroAddress)

      await rentals.connect(lessor).acceptOffer({ ...offerParams, signature: await getOfferSignature(tenant, rentals, offerParams) })

      expect((await rentals.rentals(land.address, tokenId)).tenant).to.equal(tenant.address)

      await evmIncreaseTime(daysToSeconds(offerParams.rentalDays))
      await evmMine()

      await rentals.connect(lessor).claim(land.address, tokenId)

      expect((await rentals.rentals(land.address, tokenId)).tenant).to.equal(zeroAddress)
    })

    it('should transfer the asset to the original owner', async () => {
      await rentals.connect(lessor).acceptOffer({ ...offerParams, signature: await getOfferSignature(tenant, rentals, offerParams) })

      await evmIncreaseTime(daysToSeconds(offerParams.rentalDays))
      await evmMine()

      expect(await land.ownerOf(tokenId)).to.equal(rentals.address)

      await rentals.connect(lessor).claim(land.address, tokenId)

      expect(await land.ownerOf(tokenId)).to.equal(lessor.address)
    })

    it('should emit an AssetClaimed event', async () => {
      await rentals.connect(lessor).acceptOffer({ ...offerParams, signature: await getOfferSignature(tenant, rentals, offerParams) })

      await evmIncreaseTime(daysToSeconds(offerParams.rentalDays))
      await evmMine()

      await expect(rentals.connect(lessor).claim(land.address, tokenId))
        .to.emit(rentals, 'AssetClaimed')
        .withArgs(land.address, tokenId, lessor.address)
    })

    it('should accept a meta tx', async () => {
      await rentals.connect(lessor).acceptOffer({ ...offerParams, signature: await getOfferSignature(tenant, rentals, offerParams) })

      await evmIncreaseTime(daysToSeconds(offerParams.rentalDays))
      await evmMine()

      const abi = ['function claim(address _contractAddress, uint256 _tokenId)']
      const iface = new ethers.utils.Interface(abi)
      const functionData = iface.encodeFunctionData('claim', [land.address, tokenId])
      const metaTxSignature = await getMetaTxSignature(lessor, rentals, functionData)

      expect(await land.ownerOf(tokenId)).to.equal(rentals.address)
      await rentals.connect(lessor).executeMetaTransaction(lessor.address, functionData, metaTxSignature)
      expect(await land.ownerOf(tokenId)).to.equal(lessor.address)
    })

    it('should revert when the asset is currently being rented', async () => {
      await rentals.connect(lessor).acceptOffer({ ...offerParams, signature: await getOfferSignature(tenant, rentals, offerParams) })

      await expect(rentals.connect(lessor).claim(land.address, tokenId)).to.be.revertedWith('Rentals#claim: CURRENTLY_RENTED')
    })

    it('should revert when the caller is not the original owner of the asset', async () => {
      await rentals.connect(lessor).acceptOffer({ ...offerParams, signature: await getOfferSignature(tenant, rentals, offerParams) })

      await evmIncreaseTime(daysToSeconds(offerParams.rentalDays))
      await evmMine()

      await expect(rentals.connect(tenant).claim(land.address, tokenId)).to.be.revertedWith('Rentals#claim: NOT_LESSOR')
    })
  })

  describe('setOperator', () => {
    const newOperator = zeroAddress

    beforeEach(async () => {
      await rentals.connect(deployer).initialize(owner.address, mana.address, collector.address, fee)
    })

    it('should allow the tenant to update the asset operator', async () => {
      await rentals.connect(lessor).acceptOffer({ ...offerParams, signature: await getOfferSignature(tenant, rentals, offerParams) })

      await rentals.connect(tenant).setOperator(land.address, tokenId, newOperator)
    })

    it('should allow the lessor to update the asset operator after the rent is over', async () => {
      await rentals.connect(lessor).acceptOffer({ ...offerParams, signature: await getOfferSignature(tenant, rentals, offerParams) })

      await evmIncreaseTime(daysToSeconds(offerParams.rentalDays))
      await evmMine()

      await rentals.connect(lessor).setOperator(land.address, tokenId, newOperator)
    })

    it('should revert when the asset has never been rented', async () => {
      const setOperatorByLessor = rentals.connect(lessor).setOperator(land.address, tokenId, newOperator)
      const setOperatorByTenant = rentals.connect(tenant).setOperator(land.address, tokenId, newOperator)

      await expect(setOperatorByLessor).to.be.revertedWith('Rentals#setOperator: CANNOT_UPDATE_OPERATOR')
      await expect(setOperatorByTenant).to.be.revertedWith('Rentals#setOperator: CANNOT_UPDATE_OPERATOR')
    })

    it('should revert when the tenant tries to update the operator after the rent is over', async () => {
      await rentals.connect(lessor).acceptOffer({ ...offerParams, signature: await getOfferSignature(tenant, rentals, offerParams) })

      await evmIncreaseTime(daysToSeconds(offerParams.rentalDays))
      await evmMine()

      const setOperator = rentals.connect(tenant).setOperator(land.address, tokenId, newOperator)

      await expect(setOperator).to.be.revertedWith('Rentals#setOperator: CANNOT_UPDATE_OPERATOR')
    })

    it('should revert when the lessor tries to update the operator before the rental ends', async () => {
      await rentals.connect(lessor).acceptOffer({ ...offerParams, signature: await getOfferSignature(tenant, rentals, offerParams) })

      const setOperator = rentals.connect(lessor).setOperator(land.address, tokenId, newOperator)

      await expect(setOperator).to.be.revertedWith('Rentals#setOperator: CANNOT_UPDATE_OPERATOR')
    })
  })

  describe('onERC721Received', () => {
    let offerEncodeType: string
    let offerEncodeValue: any

    const [
      signerIndex,
      contractAddressIndex,
      tokenIdIndex,
      expirationIndex,
      noncesIndex,
      pricePerDayIndex,
      rentalDaysIndex,
      operatorIndex,
      fingerprintIndex,
      signatureIndex,
    ] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]

    beforeEach(async () => {
      offerEncodeType = 'tuple(address,address,uint256,uint256,uint256[3],uint256,uint256,address,bytes32,bytes)'

      offerEncodeValue = [
        offerParams.signer,
        offerParams.contractAddress,
        offerParams.tokenId,
        offerParams.expiration,
        offerParams.nonces,
        offerParams.pricePerDay,
        offerParams.rentalDays,
        offerParams.operator,
        offerParams.fingerprint,
        await getOfferSignature(tenant, rentals, offerParams),
      ]

      await rentals.connect(deployer).initialize(owner.address, mana.address, collector.address, fee)
    })

    it('should emit a RentalStarted event with onERC721Received _operator as sender', async () => {
      const bytes = ethers.utils.defaultAbiCoder.encode([offerEncodeType], [offerEncodeValue])

      await expect(land.connect(lessor)['safeTransferFrom(address,address,uint256,bytes)'](lessor.address, rentals.address, tokenId, bytes))
        .to.emit(rentals, 'RentalStarted')
        .withArgs(
          offerEncodeValue[contractAddressIndex],
          offerEncodeValue[tokenIdIndex],
          lessor.address,
          offerEncodeValue[signerIndex],
          offerEncodeValue[operatorIndex],
          offerEncodeValue[rentalDaysIndex],
          offerEncodeValue[pricePerDayIndex],
          land.address
        )
    })

    it('should emit an AssetNonceUpdated event for the lessor and the tenant with onERC721Received _operator as sender', async () => {
      const bytes = ethers.utils.defaultAbiCoder.encode([offerEncodeType], [offerEncodeValue])

      await expect(land.connect(lessor)['safeTransferFrom(address,address,uint256,bytes)'](lessor.address, rentals.address, tokenId, bytes))
        .to.emit(rentals, 'AssetNonceUpdated')
        .withArgs(0, 1, offerEncodeValue[contractAddressIndex], offerEncodeValue[tokenIdIndex], lessor.address, land.address)
        .to.emit(rentals, 'AssetNonceUpdated')
        .withArgs(0, 1, offerEncodeValue[contractAddressIndex], offerEncodeValue[tokenIdIndex], offerEncodeValue[signerIndex], land.address)
    })

    it('should should set the _operator of the onERC721Received as lessor', async () => {
      await land.connect(lessor).setApprovalForAll(extra.address, true)

      const bytes = ethers.utils.defaultAbiCoder.encode([offerEncodeType], [offerEncodeValue])

      let rental = await rentals.rentals(offerEncodeValue[contractAddressIndex], offerEncodeValue[tokenIdIndex])

      expect(rental.lessor).to.equal(zeroAddress)

      await land.connect(extra)['safeTransferFrom(address,address,uint256,bytes)'](lessor.address, rentals.address, tokenId, bytes)

      rental = await rentals.rentals(offerEncodeValue[contractAddressIndex], offerEncodeValue[tokenIdIndex])

      expect(rental.lessor).to.equal(extra.address)

      await evmIncreaseTime(daysToSeconds(offerEncodeValue[rentalDaysIndex]))
      await evmMine()

      await expect(rentals.connect(lessor).claim(offerEncodeValue[contractAddressIndex], offerEncodeValue[tokenIdIndex])).to.be.revertedWith(
        'Rentals#claim: NOT_LESSOR'
      )

      await rentals.connect(extra).claim(offerEncodeValue[contractAddressIndex], offerEncodeValue[tokenIdIndex])

      expect(await land.ownerOf(offerEncodeValue[tokenIdIndex])).to.equal(extra.address)
    })

    it('should allow the asset transfer from accepting an offer', async () => {
      expect(await land.ownerOf(tokenId)).to.equal(lessor.address)

      await rentals.connect(lessor).acceptOffer({ ...offerParams, signature: await getOfferSignature(tenant, rentals, offerParams) })

      expect(await land.ownerOf(tokenId)).to.equal(rentals.address)
    })

    it('should allow the asset transfer from accepting a listing', async () => {
      expect(await land.ownerOf(tokenId)).to.equal(lessor.address)

      await rentals
        .connect(tenant)
        .acceptListing(
          { ...listingParams, signature: await getListingSignature(lessor, rentals, listingParams) },
          acceptListingParams.operator,
          acceptListingParams.index,
          acceptListingParams.rentalDays,
          acceptListingParams.fingerprint
        )

      expect(await land.ownerOf(tokenId)).to.equal(rentals.address)
    })

    it('should accept an offer by transfering the asset to the rentals contract with the offer data', async () => {
      expect(await land.ownerOf(tokenId)).to.equal(lessor.address)

      let rental = await rentals.rentals(offerParams.contractAddress, offerParams.tokenId)

      expect(rental.lessor).to.equal(zeroAddress)
      expect(rental.tenant).to.equal(zeroAddress)
      expect(rental.endDate).to.equal(0)

      const bytes = ethers.utils.defaultAbiCoder.encode([offerEncodeType], [offerEncodeValue])

      await land.connect(lessor)['safeTransferFrom(address,address,uint256,bytes)'](lessor.address, rentals.address, tokenId, bytes)

      expect(await land.ownerOf(tokenId)).to.equal(rentals.address)

      rental = await rentals.rentals(offerParams.contractAddress, offerParams.tokenId)

      const latestBlockTimestamp = await getLatestBlockTimestamp()

      expect(rental.lessor).to.equal(lessor.address)
      expect(rental.tenant).to.equal(tenant.address)
      expect(rental.endDate).to.equal(latestBlockTimestamp + daysToSeconds(offerParams.rentalDays))
    })

    it('should consume less gas that acceptOffer', async () => {
      const newSnapshotId = await network.provider.send('evm_snapshot')

      const bytes = ethers.utils.defaultAbiCoder.encode([offerEncodeType], [offerEncodeValue])
      const safeTransferResult = await land
        .connect(lessor)
        ['safeTransferFrom(address,address,uint256,bytes)'](lessor.address, rentals.address, tokenId, bytes)
      const safeTransferReceipt = await safeTransferResult.wait()

      await network.provider.send('evm_revert', [newSnapshotId])

      const acceptOfferResult = await rentals
        .connect(tenant)
        .acceptListing(
          { ...listingParams, signature: await getListingSignature(lessor, rentals, listingParams) },
          acceptListingParams.operator,
          acceptListingParams.index,
          acceptListingParams.rentalDays,
          acceptListingParams.fingerprint
        )
      const acceptOfferReceipt = await acceptOfferResult.wait()

      expect(safeTransferReceipt.gasUsed < acceptOfferReceipt.gasUsed).to.be.true
    })

    it('should revert when the caller is different from the contract address provided in the offer', async () => {
      const bytes = ethers.utils.defaultAbiCoder.encode([offerEncodeType], [offerEncodeValue])
      await expect(rentals.onERC721Received(extra.address, lessor.address, tokenId, bytes)).to.be.revertedWith(
        'Rentals#onERC721Received: ASSET_MISMATCH'
      )
    })

    it('should revert when the sent asset is not the one in the offer', async () => {
      offerEncodeValue[contractAddressIndex] = estate.address
      offerEncodeValue[signatureIndex] = await getOfferSignature(tenant, rentals, {
        ...offerParams,
        contractAddress: offerEncodeValue[contractAddressIndex],
      })

      const bytes = ethers.utils.defaultAbiCoder.encode([offerEncodeType], [offerEncodeValue])

      await expect(
        land.connect(lessor)['safeTransferFrom(address,address,uint256,bytes)'](lessor.address, rentals.address, tokenId, bytes)
      ).to.be.revertedWith('Rentals#onERC721Received: ASSET_MISMATCH')
    })

    it('should revert when the offer token id is different than the sent asset token id', async () => {
      await land.connect(deployer).assignNewParcel(0, 1, lessor.address)

      offerEncodeValue[tokenIdIndex] = await land.encodeTokenId(0, 1)
      offerEncodeValue[signatureIndex] = await getOfferSignature(tenant, rentals, { ...offerParams, tokenId: offerEncodeValue[tokenIdIndex] })

      const bytes = ethers.utils.defaultAbiCoder.encode([offerEncodeType], [offerEncodeValue])

      await expect(
        land.connect(lessor)['safeTransferFrom(address,address,uint256,bytes)'](lessor.address, rentals.address, tokenId, bytes)
      ).to.be.revertedWith('Rentals#onERC721Received: ASSET_MISMATCH')
    })

    it('should revert when the offer signer does not match the signer provided in params', async () => {
      offerEncodeValue[signerIndex] = lessor.address

      const bytes = ethers.utils.defaultAbiCoder.encode([offerEncodeType], [offerEncodeValue])

      await expect(
        land.connect(lessor)['safeTransferFrom(address,address,uint256,bytes)'](lessor.address, rentals.address, tokenId, bytes)
      ).to.be.revertedWith('Rentals#acceptOffer: SIGNATURE_MISSMATCH')
    })

    it('should revert when lessor is same as tenant', async () => {
      offerEncodeValue[signerIndex] = lessor.address
      offerEncodeValue[signatureIndex] = await getOfferSignature(lessor, rentals, { ...offerParams, signer: offerEncodeValue[signerIndex] })

      const bytes = ethers.utils.defaultAbiCoder.encode([offerEncodeType], [offerEncodeValue])

      await expect(
        land.connect(lessor)['safeTransferFrom(address,address,uint256,bytes)'](lessor.address, rentals.address, tokenId, bytes)
      ).to.be.revertedWith('Rentals#acceptOffer: CALLER_CANNOT_BE_SIGNER')
    })

    it('should revert when the block timestamp is higher than the provided tenant signature expiration', async () => {
      offerEncodeValue[expirationIndex] = now() - 1000
      offerEncodeValue[signatureIndex] = await getOfferSignature(tenant, rentals, { ...offerParams, expiration: offerEncodeValue[expirationIndex] })

      const bytes = ethers.utils.defaultAbiCoder.encode([offerEncodeType], [offerEncodeValue])

      await expect(
        land.connect(lessor)['safeTransferFrom(address,address,uint256,bytes)'](lessor.address, rentals.address, tokenId, bytes)
      ).to.be.revertedWith('Rentals#acceptOffer: EXPIRED_SIGNATURE')
    })

    it('should revert when tenant rental days is zero', async () => {
      offerEncodeValue[rentalDaysIndex] = 0
      offerEncodeValue[signatureIndex] = await getOfferSignature(tenant, rentals, { ...offerParams, rentalDays: offerEncodeValue[rentalDaysIndex] })

      const bytes = ethers.utils.defaultAbiCoder.encode([offerEncodeType], [offerEncodeValue])

      await expect(
        land.connect(lessor)['safeTransferFrom(address,address,uint256,bytes)'](lessor.address, rentals.address, tokenId, bytes)
      ).to.be.revertedWith('Rentals#acceptOffer: RENTAL_DAYS_IS_ZERO')
    })

    it('should revert when tenant contract nonce is not the same as the contract', async () => {
      offerEncodeValue[noncesIndex] = [1, 0, 0]
      offerEncodeValue[signatureIndex] = await getOfferSignature(tenant, rentals, { ...offerParams, nonces: offerEncodeValue[noncesIndex] })

      const bytes = ethers.utils.defaultAbiCoder.encode([offerEncodeType], [offerEncodeValue])

      await expect(
        land.connect(lessor)['safeTransferFrom(address,address,uint256,bytes)'](lessor.address, rentals.address, tokenId, bytes)
      ).to.be.revertedWith('NonceVerifiable#_verifyContractNonce: CONTRACT_NONCE_MISSMATCH')
    })

    it('should revert when tenant signer nonce is not the same as the contract', async () => {
      offerEncodeValue[noncesIndex] = [0, 1, 0]
      offerEncodeValue[signatureIndex] = await getOfferSignature(tenant, rentals, { ...offerParams, nonces: offerEncodeValue[noncesIndex] })

      const bytes = ethers.utils.defaultAbiCoder.encode([offerEncodeType], [offerEncodeValue])

      await expect(
        land.connect(lessor)['safeTransferFrom(address,address,uint256,bytes)'](lessor.address, rentals.address, tokenId, bytes)
      ).to.be.revertedWith('NonceVerifiable#_verifySignerNonce: SIGNER_NONCE_MISSMATCH')
    })

    it('should revert when tenant asset nonce is not the same as the contract', async () => {
      offerEncodeValue[noncesIndex] = [0, 0, 1]
      offerEncodeValue[signatureIndex] = await getOfferSignature(tenant, rentals, { ...offerParams, nonces: offerEncodeValue[noncesIndex] })

      const bytes = ethers.utils.defaultAbiCoder.encode([offerEncodeType], [offerEncodeValue])

      await expect(
        land.connect(lessor)['safeTransferFrom(address,address,uint256,bytes)'](lessor.address, rentals.address, tokenId, bytes)
      ).to.be.revertedWith('NonceVerifiable#_verifyAssetNonce: ASSET_NONCE_MISSMATCH')
    })

    it("should revert when the provided contract address's `verifyFingerprint` returns false", async () => {
      offerEncodeValue[contractAddressIndex] = estate.address
      offerEncodeValue[tokenIdIndex] = estateId
      offerEncodeValue[signatureIndex] = await getOfferSignature(tenant, rentals, {
        ...offerParams,
        contractAddress: offerEncodeValue[contractAddressIndex],
        tokenId: offerEncodeValue[tokenIdIndex],
      })

      const bytes = ethers.utils.defaultAbiCoder.encode([offerEncodeType], [offerEncodeValue])

      await expect(
        estate.connect(lessor)['safeTransferFrom(address,address,uint256,bytes)'](lessor.address, rentals.address, estateId, bytes)
      ).to.be.revertedWith('Rentals#_rent: INVALID_FINGERPRINT')
    })

    it("should NOT revert when the provided contract address's `verifyFingerprint` returns true", async () => {
      offerEncodeValue[contractAddressIndex] = estate.address
      offerEncodeValue[tokenIdIndex] = estateId
      offerEncodeValue[fingerprintIndex] = await estate.connect(tenant).getFingerprint(estateId)
      offerEncodeValue[signatureIndex] = await getOfferSignature(tenant, rentals, {
        ...offerParams,
        contractAddress: offerEncodeValue[contractAddressIndex],
        tokenId: offerEncodeValue[tokenIdIndex],
        fingerprint: offerEncodeValue[fingerprintIndex],
      })

      const bytes = ethers.utils.defaultAbiCoder.encode([offerEncodeType], [offerEncodeValue])

      await estate.connect(lessor)['safeTransferFrom(address,address,uint256,bytes)'](lessor.address, rentals.address, estateId, bytes)
    })
  })
})
