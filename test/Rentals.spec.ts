import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber } from 'ethers'
import { ethers, network } from 'hardhat'
import { DummyComposableERC721, DummyERC20, DummyERC721 } from '../typechain-types'
import { Rentals } from '../typechain-types/Rentals'
import {
  daysToSeconds,
  ether,
  getLessorSignature,
  getMetaTxSignature,
  getRandomBytes32,
  getTenantSignature,
  getZeroBytes32,
  now,
} from './utils/rentals'

const zeroAddress = '0x0000000000000000000000000000000000000000'
const maxUint256 = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
const tokenId = 1
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
  let erc721: DummyERC721
  let composableErc721: DummyComposableERC721
  let erc20: DummyERC20
  let lessorParams: Omit<Rentals.LessorStruct, 'signature'>
  let tenantParams: Omit<Rentals.TenantStruct, 'signature'>
  let snapshotId: any

  beforeEach(async () => {
    snapshotId = await network.provider.send('evm_snapshot')

    // Store addresses
    ;[deployer, owner, tenant, lessor, operator, collector, extra] = await ethers.getSigners()

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
      expiration: now() + 1000,
      nonces: [0, 0, 0],
      pricePerDay: [ether('100')],
      maxDays: [20],
      minDays: [10],
    }

    tenantParams = {
      signer: tenant.address,
      contractAddress: erc721.address,
      tokenId,
      fingerprint: getZeroBytes32(),
      pricePerDay: ether('100'),
      expiration: now() + 1000,
      nonces: [0, 0, 0],
      rentalDays: 15,
      operator: operator.address,
    }
  })

  afterEach(async () => {
    await network.provider.send('evm_revert', [snapshotId])
  })

  describe('initialize', () => {
    beforeEach(async () => {
      await rentals.connect(deployer).initialize(owner.address, erc20.address, collector.address, fee)
    })

    it('should set the owner', async () => {
      expect(await rentals.owner()).to.be.equal(owner.address)
    })

    it('should set the erc20 token', async () => {
      expect(await rentals.token()).to.be.equal(erc20.address)
    })

    it('should set the fee collector', async () => {
      expect(await rentals.feeCollector()).to.be.equal(collector.address)
    })

    it('should set the fee', async () => {
      expect(await rentals.fee()).to.be.equal(fee)
    })

    it('should revert when initialized more than once', async () => {
      await expect(rentals.connect(deployer).initialize(owner.address, erc20.address, collector.address, fee)).to.be.revertedWith(
        'Initializable: contract is already initialized'
      )
    })
  })

  describe('setToken', () => {
    let oldToken: string
    let newToken: string

    beforeEach(async () => {
      oldToken = erc20.address
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
      await rentals.connect(deployer).initialize(owner.address, erc20.address, collector.address, fee)
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
      await rentals.connect(deployer).initialize(owner.address, erc20.address, collector.address, fee)
    })

    it('should increase the signerNonce for the sender by 1', async () => {
      expect(await rentals.connect(lessor).signerNonce(lessor.address)).to.equal(0)
      await rentals.connect(lessor).bumpSignerNonce()
      expect(await rentals.connect(lessor).signerNonce(lessor.address)).to.equal(1)
    })

    it('should emit an SignerNonceUpdated event', async () => {
      await expect(rentals.connect(lessor).bumpSignerNonce()).to.emit(rentals, 'SignerNonceUpdated').withArgs(0, 1, lessor.address)
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
      await rentals.connect(deployer).initialize(owner.address, erc20.address, collector.address, fee)
    })

    it('should increase the assetNonce for the sender by 1', async () => {
      expect(await rentals.connect(lessor).assetNonce(erc721.address, tokenId, lessor.address)).to.equal(0)
      await rentals.connect(lessor).bumpAssetNonce(erc721.address, tokenId)
      expect(await rentals.connect(lessor).assetNonce(erc721.address, tokenId, lessor.address)).to.equal(1)
    })

    it('should emit an AssetNonceUpdated event', async () => {
      await expect(rentals.connect(lessor).bumpAssetNonce(erc721.address, tokenId))
        .to.emit(rentals, 'AssetNonceUpdated')
        .withArgs(0, 1, erc721.address, tokenId, lessor.address, lessor.address)
    })

    it('should accept a meta tx', async () => {
      const abi = ['function bumpAssetNonce(address _contractAddress, uint256 _tokenId)']
      const iface = new ethers.utils.Interface(abi)
      const functionData = iface.encodeFunctionData('bumpAssetNonce', [erc721.address, tokenId])
      const metaTxSignature = await getMetaTxSignature(lessor, rentals, functionData)

      expect(await rentals.connect(lessor).assetNonce(erc721.address, tokenId, lessor.address)).to.equal(0)
      await rentals.connect(lessor).executeMetaTransaction(lessor.address, functionData, metaTxSignature)
      expect(await rentals.connect(lessor).assetNonce(erc721.address, tokenId, lessor.address)).to.equal(1)
    })
  })

  describe('getAssetNonce', () => {
    beforeEach(async () => {
      await rentals.connect(deployer).initialize(owner.address, erc20.address, collector.address, fee)
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
      await rentals.connect(lessor).acceptOffer({ ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) })

      expect(await rentals.connect(lessor).assetNonce(erc721.address, tokenId, lessor.address)).to.equal(1)
      expect(await rentals.connect(lessor).assetNonce(erc721.address, tokenId, tenant.address)).to.equal(1)
    })
  })

  describe('getLessor', () => {
    beforeEach(async () => {
      await rentals.connect(deployer).initialize(owner.address, erc20.address, collector.address, fee)
    })

    it('should return address(0) when nothing is set', async () => {
      expect(await rentals.connect(lessor).getLessor(erc721.address, tokenId)).to.equal(zeroAddress)
    })

    it('should return the address of the lessor after starting a rent', async () => {
      await rentals.connect(lessor).acceptOffer({ ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) })

      expect(await rentals.connect(lessor).getLessor(erc721.address, tokenId)).to.equal(lessor.address)
    })

    it('should return the address of the lessor after the rent is over', async () => {
      await rentals.connect(lessor).acceptOffer({ ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) })

      expect(await rentals.connect(lessor).isRented(erc721.address, tokenId)).to.equal(true)

      await network.provider.send('evm_increaseTime', [daysToSeconds(tenantParams.rentalDays)])
      await network.provider.send('evm_mine')

      expect(await rentals.connect(lessor).isRented(erc721.address, tokenId)).to.equal(false)
      expect(await rentals.connect(lessor).getLessor(erc721.address, tokenId)).to.equal(lessor.address)
    })
  })

  describe('getTenant', () => {
    beforeEach(async () => {
      await rentals.connect(deployer).initialize(owner.address, erc20.address, collector.address, fee)
    })

    it('should return address(0) when nothing is set', async () => {
      expect(await rentals.connect(tenant).getTenant(erc721.address, tokenId)).to.equal(zeroAddress)
    })

    it('should return the address of the tenant after starting a rent', async () => {
      await rentals.connect(lessor).acceptOffer({ ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) })

      expect(await rentals.connect(lessor).getTenant(erc721.address, tokenId)).to.equal(tenant.address)
    })

    it('should return the address of the tenant after the rent is over', async () => {
      await rentals.connect(lessor).acceptOffer({ ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) })

      expect(await rentals.connect(lessor).isRented(erc721.address, tokenId)).to.equal(true)

      await network.provider.send('evm_increaseTime', [daysToSeconds(tenantParams.rentalDays)])
      await network.provider.send('evm_mine')

      expect(await rentals.connect(lessor).isRented(erc721.address, tokenId)).to.equal(false)
      expect(await rentals.connect(lessor).getTenant(erc721.address, tokenId)).to.equal(tenant.address)
    })
  })

  describe('getRentalEnd', () => {
    beforeEach(async () => {
      await rentals.connect(deployer).initialize(owner.address, erc20.address, collector.address, fee)
    })

    it('should return 0 when the asset was never rented', async () => {
      expect(await rentals.connect(lessor).getRentalEnd(erc721.address, tokenId)).to.equal(0)
    })

    it('should return the timestamp of when the rend will finish after being rented', async () => {
      const latestBlock = await ethers.provider.getBlock('latest')
      const latestBlockTime = latestBlock.timestamp

      await rentals.connect(lessor).acceptOffer({ ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) })

      expect(await rentals.connect(lessor).getRentalEnd(erc721.address, tokenId)).to.equal(
        latestBlockTime + daysToSeconds(tenantParams.rentalDays) + 1
      )
    })
  })

  describe('isRented', () => {
    beforeEach(async () => {
      await rentals.connect(deployer).initialize(owner.address, erc20.address, collector.address, fee)
    })

    it('should return false when the asset was never rented', async () => {
      expect(await rentals.connect(lessor).isRented(erc721.address, tokenId)).to.equal(false)
    })

    it('should return true after an asset is rented', async () => {
      await rentals.connect(lessor).acceptOffer({ ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) })

      expect(await rentals.connect(lessor).isRented(erc721.address, tokenId)).to.equal(true)
    })

    it('should return false after and asset is rented and enough time passes to surpass the rental end time', async () => {
      await rentals.connect(lessor).acceptOffer({ ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) })

      await network.provider.send('evm_increaseTime', [daysToSeconds(tenantParams.rentalDays)])
      await network.provider.send('evm_mine')

      expect(await rentals.connect(lessor).isRented(erc721.address, tokenId)).to.equal(false)
    })
  })

  describe('acceptOffer', () => {
    beforeEach(async () => {
      await rentals.connect(deployer).initialize(owner.address, erc20.address, collector.address, fee)
    })

    it('should emit a RentalStarted event', async () => {
      await expect(rentals.connect(lessor).acceptOffer({ ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) }))
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

    it('should emit an AssetNonceUpdated event for the lessor and the tenant', async () => {
      await expect(rentals.connect(lessor).acceptOffer({ ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) }))
        .to.emit(rentals, 'AssetNonceUpdated')
        .withArgs(0, 1, lessorParams.contractAddress, lessorParams.tokenId, lessorParams.signer, lessor.address)
        .to.emit(rentals, 'AssetNonceUpdated')
        .withArgs(0, 1, tenantParams.contractAddress, tenantParams.tokenId, tenantParams.signer, lessor.address)
    })

    it('should update lessors mapping with lessor when the contract does not own the asset already', async () => {
      expect(await rentals.connect(lessor).getLessor(erc721.address, tokenId)).to.equal(zeroAddress)

      await rentals.connect(lessor).acceptOffer({ ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) })

      expect(await rentals.connect(lessor).getLessor(erc721.address, tokenId)).to.equal(lessor.address)
    })

    it('should bump both the lessor and tenant asset nonces', async () => {
      expect(await rentals.connect(lessor).getAssetNonce(erc721.address, tokenId, lessor.address)).to.equal(0)
      expect(await rentals.connect(lessor).getAssetNonce(erc721.address, tokenId, tenant.address)).to.equal(0)

      await rentals.connect(lessor).acceptOffer({ ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) })

      expect(await rentals.connect(lessor).getAssetNonce(erc721.address, tokenId, lessor.address)).to.equal(1)
      expect(await rentals.connect(lessor).getAssetNonce(erc721.address, tokenId, tenant.address)).to.equal(1)
    })

    it('should update the rentals mapping for the rented asset with the rental finish timestamp', async () => {
      expect(await rentals.connect(lessor).getRentalEnd(erc721.address, tokenId)).to.equal(0)

      const latestBlock = await ethers.provider.getBlock('latest')
      const latestBlockTime = latestBlock.timestamp

      await rentals.connect(lessor).acceptOffer({ ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) })

      expect(await rentals.connect(lessor).getRentalEnd(erc721.address, tokenId)).to.equal(
        latestBlockTime + daysToSeconds(tenantParams.rentalDays) + 1
      )
    })

    it('should not transfer erc20 when price per day is 0', async () => {
      const originalBalanceTenant = await erc20.balanceOf(tenant.address)
      const originalBalanceLessor = await erc20.balanceOf(lessor.address)
      const originalBalanceCollector = await erc20.balanceOf(collector.address)

      tenantParams.pricePerDay = '0'

      await rentals.connect(lessor).acceptOffer({ ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) })

      expect(await erc20.balanceOf(tenant.address)).to.equal(originalBalanceTenant)
      expect(await erc20.balanceOf(lessor.address)).to.equal(originalBalanceLessor)
      expect(await erc20.balanceOf(collector.address)).to.equal(originalBalanceCollector)
    })

    it('should transfer erc20 from the tenant to the lessor and collector', async () => {
      const originalBalanceTenant = await erc20.balanceOf(tenant.address)
      const originalBalanceLessor = await erc20.balanceOf(lessor.address)
      const originalBalanceCollector = await erc20.balanceOf(collector.address)

      await rentals.connect(lessor).acceptOffer({ ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) })

      const total = BigNumber.from(tenantParams.pricePerDay).mul(tenantParams.rentalDays)
      const forCollector = total.mul(BigNumber.from(fee)).div(BigNumber.from(1000000))
      const forLessor = total.sub(forCollector)

      expect(await erc20.balanceOf(tenant.address)).to.equal(originalBalanceTenant.sub(total))
      expect(await erc20.balanceOf(lessor.address)).to.equal(originalBalanceLessor.add(forLessor))
      expect(await erc20.balanceOf(collector.address)).to.equal(originalBalanceCollector.add(forCollector))
    })

    it('should not transfer erc20 to collector when fee is 0', async () => {
      const originalBalanceTenant = await erc20.balanceOf(tenant.address)
      const originalBalanceLessor = await erc20.balanceOf(lessor.address)
      const originalBalanceCollector = await erc20.balanceOf(collector.address)

      await rentals.connect(owner).setFee('0')

      await rentals.connect(lessor).acceptOffer({ ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) })

      const total = BigNumber.from(tenantParams.pricePerDay).mul(tenantParams.rentalDays)

      expect(await erc20.balanceOf(tenant.address)).to.equal(originalBalanceTenant.sub(total))
      expect(await erc20.balanceOf(lessor.address)).to.equal(originalBalanceLessor.add(total))
      expect(await erc20.balanceOf(collector.address)).to.equal(originalBalanceCollector)
    })

    it('should not transfer erc20 to lessor when fee is 1_000_000', async () => {
      const originalBalanceTenant = await erc20.balanceOf(tenant.address)
      const originalBalanceLessor = await erc20.balanceOf(lessor.address)
      const originalBalanceCollector = await erc20.balanceOf(collector.address)

      await rentals.connect(owner).setFee('1000000')

      await rentals.connect(lessor).acceptOffer({ ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) })

      const total = BigNumber.from(tenantParams.pricePerDay).mul(tenantParams.rentalDays)

      expect(await erc20.balanceOf(tenant.address)).to.equal(originalBalanceTenant.sub(total))
      expect(await erc20.balanceOf(lessor.address)).to.equal(originalBalanceLessor)
      expect(await erc20.balanceOf(collector.address)).to.equal(originalBalanceCollector.add(total))
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
              internalType: 'struct Rentals.Tenant',
              name: '_tenant',
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
        { ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) },
      ])
      const metaTxSignature = await getMetaTxSignature(lessor, rentals, functionData)

      const rent = rentals.connect(lessor).executeMetaTransaction(lessor.address, functionData, metaTxSignature)

      await expect(rent)
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

    it('should revert when the tenant signer does not match the signer provided in params', async () => {
      await expect(
        rentals
          .connect(lessor)
          .acceptOffer({ ...tenantParams, signature: await getTenantSignature(tenant, rentals, { ...tenantParams, signer: lessor.address }) })
      ).to.be.revertedWith('Rentals#_verifySignatures: INVALID_TENANT_SIGNATURE')
    })

    it('should revert when lessor is same as tenant', async () => {
      tenantParams = { ...tenantParams, signer: lessor.address }

      await expect(
        rentals.connect(lessor).acceptOffer({ ...tenantParams, signature: await getTenantSignature(lessor, rentals, tenantParams) })
      ).to.be.revertedWith('Rentals#rent: LESSOR_CANNOT_BE_TENANT')
    })

    it('should revert when the block timestamp is higher than the provided tenant signature expiration', async () => {
      tenantParams = { ...tenantParams, expiration: now() - 1000 }

      await expect(
        rentals.connect(lessor).acceptOffer({ ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) })
      ).to.be.revertedWith('Rentals#rent: EXPIRED_TENANT_SIGNATURE')
    })

    it('should revert when tenant rental days is zero', async () => {
      tenantParams = { ...tenantParams, rentalDays: 0 }

      await expect(
        rentals.connect(lessor).acceptOffer({ ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) })
      ).to.be.revertedWith('Rentals#rent: RENTAL_DAYS_CANNOT_BE_ZERO')
    })

    it('should revert when tenant contract nonce is not the same as the contract', async () => {
      tenantParams = { ...tenantParams, nonces: [1, 0, 0] }

      await expect(
        rentals.connect(lessor).acceptOffer({ ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) })
      ).to.be.revertedWith('Rentals#rent: INVALID_TENANT_CONTRACT_NONCE')
    })

    it('should revert when tenant signer nonce is not the same as the contract', async () => {
      tenantParams = { ...tenantParams, nonces: [0, 1, 0] }

      await expect(
        rentals.connect(lessor).acceptOffer({ ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) })
      ).to.be.revertedWith('Rentals#rent: INVALID_TENANT_SIGNER_NONCE')
    })

    it('should revert when tenant asset nonce is not the same as the contract', async () => {
      tenantParams = { ...tenantParams, nonces: [0, 0, 1] }

      await expect(
        rentals.connect(lessor).acceptOffer({ ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) })
      ).to.be.revertedWith('Rentals#rent: INVALID_TENANT_ASSET_NONCE')
    })

    it("should revert when the provided contract address's `verifyFingerprint` returns false", async () => {
      const DummyFalseVerifyFingerprintFactory = await ethers.getContractFactory('DummyFalseVerifyFingerprint')
      const falseVerifyFingerprint = await DummyFalseVerifyFingerprintFactory.connect(deployer).deploy()

      tenantParams = { ...tenantParams, contractAddress: falseVerifyFingerprint.address, fingerprint: getRandomBytes32() }

      await expect(
        rentals.connect(lessor).acceptOffer({ ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) })
      ).to.be.revertedWith('Rentals#rent: INVALID_FINGERPRINT')
    })

    it('should revert if an asset is already being rented', async () => {
      rentals.connect(lessor).acceptOffer({ ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) })

      lessorParams = { ...lessorParams, nonces: [0, 0, 1] }
      tenantParams = { ...tenantParams, nonces: [0, 0, 1] }

      await expect(
        rentals.connect(lessor).acceptOffer({ ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) })
      ).to.be.revertedWith('Rentals#rent: CURRENTLY_RENTED')
    })

    it('should revert if someone other than the original owner wants to rent an asset currently owned by the contract', async () => {
      await rentals.connect(lessor).acceptOffer({ ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) })

      await network.provider.send('evm_increaseTime', [daysToSeconds(tenantParams.rentalDays)])
      await network.provider.send('evm_mine')

      tenantParams = { ...tenantParams, expiration: maxUint256, nonces: [0, 0, 1] }

      await expect(
        rentals.connect(extra).acceptOffer({ ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) })
      ).to.be.revertedWith('Rentals#rent: NOT_ORIGINAL_OWNER')
    })
  })

  describe('acceptListing', () => {
    beforeEach(async () => {
      await rentals.connect(deployer).initialize(owner.address, erc20.address, collector.address, fee)
    })

    it('should emit a RentalStarted event', async () => {
      await expect(
        rentals
          .connect(tenant)
          .acceptListing(
            { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
            tenantParams.operator,
            0,
            tenantParams.rentalDays,
            tenantParams.fingerprint
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
          tenant.address
        )
    })

    it('should emit an AssetNonceUpdated event for the lessor and the tenant', async () => {
      await expect(
        rentals
          .connect(tenant)
          .acceptListing(
            { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
            tenantParams.operator,
            0,
            tenantParams.rentalDays,
            tenantParams.fingerprint
          )
      )
        .to.emit(rentals, 'AssetNonceUpdated')
        .withArgs(0, 1, lessorParams.contractAddress, lessorParams.tokenId, lessorParams.signer, tenant.address)
        .to.emit(rentals, 'AssetNonceUpdated')
        .withArgs(0, 1, tenantParams.contractAddress, tenantParams.tokenId, tenantParams.signer, tenant.address)
    })

    it('should allow the tenant to select a different option included in the tenant signature by providing a different index', async () => {
      lessorParams.pricePerDay = [...lessorParams.pricePerDay, ether('20')]
      lessorParams.maxDays = [...lessorParams.maxDays, 30]
      lessorParams.minDays = [...lessorParams.minDays, 20]

      tenantParams.pricePerDay = ether('20')
      tenantParams.rentalDays = 25

      const index = 1

      const rent = rentals
        .connect(tenant)
        .acceptListing(
          { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
          tenantParams.operator,
          index,
          tenantParams.rentalDays,
          tenantParams.fingerprint
        )

      await expect(rent)
        .to.emit(rentals, 'RentalStarted')
        .withArgs(
          tenantParams.contractAddress,
          tenantParams.tokenId,
          lessorParams.signer,
          tenantParams.signer,
          tenantParams.operator,
          tenantParams.rentalDays,
          tenantParams.pricePerDay,
          tenant.address
        )
    })

    it('should update the lessors mappingwith lessor when the contract does not own the asset already', async () => {
      expect(await rentals.connect(lessor).getLessor(erc721.address, tokenId)).to.equal(zeroAddress)

      await rentals
        .connect(tenant)
        .acceptListing(
          { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
          tenantParams.operator,
          0,
          tenantParams.rentalDays,
          tenantParams.fingerprint
        )

      expect(await rentals.connect(tenant).getLessor(erc721.address, tokenId)).to.equal(lessor.address)
    })

    it('should bump both the lessor and tenant asset nonces', async () => {
      expect(await rentals.connect(lessor).getAssetNonce(erc721.address, tokenId, lessor.address)).to.equal(0)
      expect(await rentals.connect(lessor).getAssetNonce(erc721.address, tokenId, tenant.address)).to.equal(0)

      await rentals
        .connect(tenant)
        .acceptListing(
          { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
          tenantParams.operator,
          0,
          tenantParams.rentalDays,
          tenantParams.fingerprint
        )

      expect(await rentals.connect(lessor).getAssetNonce(erc721.address, tokenId, lessor.address)).to.equal(1)
      expect(await rentals.connect(lessor).getAssetNonce(erc721.address, tokenId, tenant.address)).to.equal(1)
    })

    it('should update the ongoing rentals mapping for the rented asset', async () => {
      expect(await rentals.connect(lessor).getRentalEnd(erc721.address, tokenId)).to.equal(0)

      const latestBlock = await ethers.provider.getBlock('latest')
      const latestBlockTime = latestBlock.timestamp

      await rentals
        .connect(tenant)
        .acceptListing(
          { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
          tenantParams.operator,
          0,
          tenantParams.rentalDays,
          tenantParams.fingerprint
        )

      expect(await rentals.connect(lessor).getRentalEnd(erc721.address, tokenId)).to.equal(
        latestBlockTime + daysToSeconds(tenantParams.rentalDays) + 1
      )
    })

    it('should not transfer erc20 when price per day is 0', async () => {
      const originalBalanceTenant = await erc20.balanceOf(tenant.address)
      const originalBalanceLessor = await erc20.balanceOf(lessor.address)
      const originalBalanceCollector = await erc20.balanceOf(collector.address)

      lessorParams.pricePerDay = ['0']
      tenantParams.pricePerDay = '0'

      await rentals
        .connect(tenant)
        .acceptListing(
          { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
          tenantParams.operator,
          0,
          tenantParams.rentalDays,
          tenantParams.fingerprint
        )

      expect(await erc20.balanceOf(tenant.address)).to.equal(originalBalanceTenant)
      expect(await erc20.balanceOf(lessor.address)).to.equal(originalBalanceLessor)
      expect(await erc20.balanceOf(collector.address)).to.equal(originalBalanceCollector)
    })

    it('should transfer erc20 from the tenant to the lessor and collector', async () => {
      const originalBalanceTenant = await erc20.balanceOf(tenant.address)
      const originalBalanceLessor = await erc20.balanceOf(lessor.address)
      const originalBalanceCollector = await erc20.balanceOf(collector.address)

      await rentals
        .connect(tenant)
        .acceptListing(
          { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
          tenantParams.operator,
          0,
          tenantParams.rentalDays,
          tenantParams.fingerprint
        )

      const total = BigNumber.from(tenantParams.pricePerDay).mul(tenantParams.rentalDays)
      const forCollector = total.mul(BigNumber.from(fee)).div(BigNumber.from(1000000))
      const forLessor = total.sub(forCollector)

      expect(await erc20.balanceOf(tenant.address)).to.equal(originalBalanceTenant.sub(total))
      expect(await erc20.balanceOf(lessor.address)).to.equal(originalBalanceLessor.add(forLessor))
      expect(await erc20.balanceOf(collector.address)).to.equal(originalBalanceCollector.add(forCollector))
    })

    it('should not transfer erc20 to collector when fee is 0', async () => {
      const originalBalanceTenant = await erc20.balanceOf(tenant.address)
      const originalBalanceLessor = await erc20.balanceOf(lessor.address)
      const originalBalanceCollector = await erc20.balanceOf(collector.address)

      await rentals.connect(owner).setFee('0')

      await rentals
        .connect(tenant)
        .acceptListing(
          { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
          tenantParams.operator,
          0,
          tenantParams.rentalDays,
          tenantParams.fingerprint
        )

      const total = BigNumber.from(tenantParams.pricePerDay).mul(tenantParams.rentalDays)

      expect(await erc20.balanceOf(tenant.address)).to.equal(originalBalanceTenant.sub(total))
      expect(await erc20.balanceOf(lessor.address)).to.equal(originalBalanceLessor.add(total))
      expect(await erc20.balanceOf(collector.address)).to.equal(originalBalanceCollector)
    })

    it('should not transfer erc20 to lessor when fee is 1_000_000', async () => {
      const originalBalanceTenant = await erc20.balanceOf(tenant.address)
      const originalBalanceLessor = await erc20.balanceOf(lessor.address)
      const originalBalanceCollector = await erc20.balanceOf(collector.address)

      await rentals.connect(owner).setFee('1000000')

      await rentals
        .connect(tenant)
        .acceptListing(
          { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
          tenantParams.operator,
          0,
          tenantParams.rentalDays,
          tenantParams.fingerprint
        )

      const total = BigNumber.from(tenantParams.pricePerDay).mul(tenantParams.rentalDays)

      expect(await erc20.balanceOf(tenant.address)).to.equal(originalBalanceTenant.sub(total))
      expect(await erc20.balanceOf(lessor.address)).to.equal(originalBalanceLessor)
      expect(await erc20.balanceOf(collector.address)).to.equal(originalBalanceCollector.add(total))
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
                  internalType: 'bytes',
                  name: 'signature',
                  type: 'bytes',
                },
              ],
              internalType: 'struct Rentals.Lessor',
              name: '_lessor',
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
        { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
        tenantParams.operator,
        0,
        tenantParams.rentalDays,
        tenantParams.fingerprint,
      ])
      const metaTxSignature = await getMetaTxSignature(tenant, rentals, functionData)

      const rent = rentals.connect(extra).executeMetaTransaction(tenant.address, functionData, metaTxSignature)

      await expect(rent)
        .to.emit(rentals, 'RentalStarted')
        .withArgs(
          tenantParams.contractAddress,
          tenantParams.tokenId,
          lessorParams.signer,
          tenantParams.signer,
          tenantParams.operator,
          tenantParams.rentalDays,
          tenantParams.pricePerDay,
          tenant.address
        )
    })

    it('should revert when lessor is same as tenant', async () => {
      lessorParams = { ...lessorParams, signer: lessor.address }

      await expect(
        rentals
          .connect(lessor)
          .acceptListing(
            { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
            tenantParams.operator,
            0,
            tenantParams.rentalDays,
            tenantParams.fingerprint
          )
      ).to.be.revertedWith('Rentals#rent: TENANT_CANNOT_BE_LESSOR')
    })

    it('should revert when the lessor signer does not match the signer in params', async () => {
      await expect(
        rentals
          .connect(tenant)
          .acceptListing(
            { ...lessorParams, signature: await getLessorSignature(lessor, rentals, { ...lessorParams, signer: tenant.address }) },
            tenantParams.operator,
            0,
            tenantParams.rentalDays,
            tenantParams.fingerprint
          )
      ).to.be.revertedWith('Rentals#rent: INVALID_LESSOR_SIGNATURE')
    })

    it('should revert when maxDays length is different than pricePerDay length', async () => {
      lessorParams.maxDays = [10, 20]

      await expect(
        rentals
          .connect(tenant)
          .acceptListing(
            { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
            tenantParams.operator,
            0,
            tenantParams.rentalDays,
            tenantParams.fingerprint
          )
      ).to.be.revertedWith('Rentals#rent: MAX_DAYS_LENGTH_MISSMATCH')
    })

    it('should revert when minDays length is different than pricePerDay length', async () => {
      lessorParams.minDays = [10, 20]

      await expect(
        rentals
          .connect(tenant)
          .acceptListing(
            { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
            tenantParams.operator,
            0,
            tenantParams.rentalDays,
            tenantParams.fingerprint
          )
      ).to.be.revertedWith('Rentals#rent: MIN_DAYS_LENGTH_MISSMATCH')
    })

    it('should revert when tenant index is outside the pricePerDay length', async () => {
      const index = 1

      await expect(
        rentals
          .connect(tenant)
          .acceptListing(
            { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
            tenantParams.operator,
            index,
            tenantParams.rentalDays,
            tenantParams.fingerprint
          )
      ).to.be.revertedWith('Rentals#rent: INVALID_INDEX')
    })

    it('should revert when the block timestamp is higher than the provided lessor signature expiration', async () => {
      lessorParams = { ...lessorParams, expiration: now() - 1000 }

      await expect(
        rentals
          .connect(tenant)
          .acceptListing(
            { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
            tenantParams.operator,
            0,
            tenantParams.rentalDays,
            tenantParams.fingerprint
          )
      ).to.be.revertedWith('Rentals#rent: EXPIRED_LESSOR_SIGNATURE')
    })

    it('should revert when max days is lower than min days', async () => {
      lessorParams = { ...lessorParams, minDays: [BigNumber.from(lessorParams.maxDays[0]).add(1)] }

      await expect(
        rentals
          .connect(tenant)
          .acceptListing(
            { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
            tenantParams.operator,
            0,
            tenantParams.rentalDays,
            tenantParams.fingerprint
          )
      ).to.be.revertedWith('Rentals#rent: MAX_DAYS_LOWER_THAN_MIN_DAYS')
    })

    it('should revert when min days is 0', async () => {
      lessorParams = { ...lessorParams, minDays: [0] }

      await expect(
        rentals
          .connect(tenant)
          .acceptListing(
            { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
            tenantParams.operator,
            0,
            tenantParams.rentalDays,
            tenantParams.fingerprint
          )
      ).to.be.revertedWith('Rentals#rent: MIN_DAYS_CANNOT_BE_ZERO')
    })

    it('should revert when tenant days is lower than lessor min days', async () => {
      tenantParams = { ...tenantParams, rentalDays: BigNumber.from(lessorParams.minDays[0]).sub(1) }

      await expect(
        rentals
          .connect(tenant)
          .acceptListing(
            { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
            tenantParams.operator,
            0,
            tenantParams.rentalDays,
            tenantParams.fingerprint
          )
      ).to.be.revertedWith('Rentals#rent: DAYS_NOT_IN_RANGE')
    })

    it('should revert when tenant days is higher than lessor max days', async () => {
      tenantParams = { ...tenantParams, rentalDays: BigNumber.from(lessorParams.maxDays[0]).add(1) }

      await expect(
        rentals
          .connect(tenant)
          .acceptListing(
            { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
            tenantParams.operator,
            0,
            tenantParams.rentalDays,
            tenantParams.fingerprint
          )
      ).to.be.revertedWith('Rentals#rent: DAYS_NOT_IN_RANGE')
    })

    it('should revert when lessor contract nonce is not the same as the contract', async () => {
      lessorParams = { ...lessorParams, nonces: [1, 0, 0] }

      await expect(
        rentals
          .connect(tenant)
          .acceptListing(
            { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
            tenantParams.operator,
            0,
            tenantParams.rentalDays,
            tenantParams.fingerprint
          )
      ).to.be.revertedWith('Rentals#rent: INVALID_LESSOR_CONTRACT_NONCE')
    })

    it('should revert when lessor signer nonce is not the same as the contract', async () => {
      lessorParams = { ...lessorParams, nonces: [0, 1, 0] }

      await expect(
        rentals
          .connect(tenant)
          .acceptListing(
            { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
            tenantParams.operator,
            0,
            tenantParams.rentalDays,
            tenantParams.fingerprint
          )
      ).to.be.revertedWith('Rentals#rent: INVALID_LESSOR_SIGNER_NONCE')
    })

    it('should revert when lessor asset nonce is not the same as the contract', async () => {
      lessorParams = { ...lessorParams, nonces: [0, 0, 1] }

      await expect(
        rentals
          .connect(tenant)
          .acceptListing(
            { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
            tenantParams.operator,
            0,
            tenantParams.rentalDays,
            tenantParams.fingerprint
          )
      ).to.be.revertedWith('Rentals#rent: INVALID_LESSOR_ASSET_NONCE')
    })

    it("should revert when the provided contract address's `verifyFingerprint` returns false", async () => {
      const DummyFalseVerifyFingerprintFactory = await ethers.getContractFactory('DummyFalseVerifyFingerprint')
      const falseVerifyFingerprint = await DummyFalseVerifyFingerprintFactory.connect(deployer).deploy()

      lessorParams = { ...lessorParams, contractAddress: falseVerifyFingerprint.address }
      tenantParams = { ...tenantParams, contractAddress: lessorParams.contractAddress, fingerprint: getRandomBytes32() }

      await expect(
        rentals
          .connect(tenant)
          .acceptListing(
            { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
            tenantParams.operator,
            0,
            tenantParams.rentalDays,
            tenantParams.fingerprint
          )
      ).to.be.revertedWith('Rentals#rent: INVALID_FINGERPRINT')
    })

    it('should revert if an asset is already being rented', async () => {
      rentals
        .connect(tenant)
        .acceptListing(
          { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
          tenantParams.operator,
          0,
          tenantParams.rentalDays,
          tenantParams.fingerprint
        )

      lessorParams = { ...lessorParams, nonces: [0, 0, 1] }

      await expect(
        rentals
          .connect(tenant)
          .acceptListing(
            { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
            tenantParams.operator,
            0,
            tenantParams.rentalDays,
            tenantParams.fingerprint
          )
      ).to.be.revertedWith('Rentals#rent: CURRENTLY_RENTED')
    })

    it('should revert if someone other than the original owner wants to rent an asset currently owned by the contract', async () => {
      await rentals
        .connect(tenant)
        .acceptListing(
          { ...lessorParams, signature: await getLessorSignature(lessor, rentals, lessorParams) },
          tenantParams.operator,
          0,
          tenantParams.rentalDays,
          tenantParams.fingerprint
        )

      await network.provider.send('evm_increaseTime', [daysToSeconds(tenantParams.rentalDays)])
      await network.provider.send('evm_mine')

      lessorParams = { ...lessorParams, signer: extra.address, expiration: maxUint256 }

      await expect(
        rentals
          .connect(tenant)
          .acceptListing(
            { ...lessorParams, signature: await getLessorSignature(extra, rentals, lessorParams) },
            tenantParams.operator,
            0,
            tenantParams.rentalDays,
            tenantParams.fingerprint
          )
      ).to.be.revertedWith('Rentals#rent: NOT_ORIGINAL_OWNER')
    })
  })

  describe('claim', () => {
    beforeEach(async () => {
      await rentals.connect(deployer).initialize(owner.address, erc20.address, collector.address, fee)
    })

    it('should set the original owner to address(0)', async () => {
      await rentals.connect(lessor).acceptOffer({ ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) })

      await network.provider.send('evm_increaseTime', [daysToSeconds(tenantParams.rentalDays)])
      await network.provider.send('evm_mine')

      await rentals.connect(lessor).claim(erc721.address, tokenId)

      expect(await rentals.getLessor(erc721.address, tokenId)).to.equal(zeroAddress)
    })

    it('should transfer the asset to the original owner', async () => {
      await rentals.connect(lessor).acceptOffer({ ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) })

      await network.provider.send('evm_increaseTime', [daysToSeconds(tenantParams.rentalDays)])
      await network.provider.send('evm_mine')

      expect(await erc721.ownerOf(tokenId)).to.equal(rentals.address)

      await rentals.connect(lessor).claim(erc721.address, tokenId)

      expect(await erc721.ownerOf(tokenId)).to.equal(lessor.address)
    })

    it('should emit an AssetClaimed event', async () => {
      await rentals.connect(lessor).acceptOffer({ ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) })

      await network.provider.send('evm_increaseTime', [daysToSeconds(tenantParams.rentalDays)])
      await network.provider.send('evm_mine')

      await expect(rentals.connect(lessor).claim(erc721.address, tokenId))
        .to.emit(rentals, 'AssetClaimed')
        .withArgs(erc721.address, tokenId, lessor.address)
    })

    it('should accept a meta tx', async () => {
      await rentals.connect(lessor).acceptOffer({ ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) })

      await network.provider.send('evm_increaseTime', [daysToSeconds(tenantParams.rentalDays)])
      await network.provider.send('evm_mine')

      const abi = ['function claim(address _contractAddress, uint256 _tokenId)']
      const iface = new ethers.utils.Interface(abi)
      const functionData = iface.encodeFunctionData('claim', [erc721.address, tokenId])
      const metaTxSignature = await getMetaTxSignature(lessor, rentals, functionData)

      expect(await erc721.ownerOf(tokenId)).to.equal(rentals.address)
      await rentals.connect(lessor).executeMetaTransaction(lessor.address, functionData, metaTxSignature)
      expect(await erc721.ownerOf(tokenId)).to.equal(lessor.address)
    })

    it('should revert when the asset is currently being rented', async () => {
      await rentals.connect(lessor).acceptOffer({ ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) })

      await expect(rentals.connect(lessor).claim(erc721.address, tokenId)).to.be.revertedWith('Rentals#claim: CURRENTLY_RENTED')
    })

    it('should revert when the caller is not the original owner of the asset', async () => {
      await rentals.connect(lessor).acceptOffer({ ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) })

      await network.provider.send('evm_increaseTime', [daysToSeconds(tenantParams.rentalDays)])
      await network.provider.send('evm_mine')

      await expect(rentals.connect(tenant).claim(erc721.address, tokenId)).to.be.revertedWith('Rentals#claim: NOT_LESSOR')
    })
  })

  describe('setOperator', () => {
    const newOperator = zeroAddress

    beforeEach(async () => {
      await rentals.connect(deployer).initialize(owner.address, erc20.address, collector.address, fee)
    })

    it('should allow the tenant to update the asset operator', async () => {
      await rentals.connect(lessor).acceptOffer({ ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) })

      await rentals.connect(tenant).setOperator(erc721.address, tokenId, newOperator)
    })

    it('should allow the lessor to update the asset operator after the rent is over', async () => {
      await rentals.connect(lessor).acceptOffer({ ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) })

      await network.provider.send('evm_increaseTime', [daysToSeconds(tenantParams.rentalDays)])
      await network.provider.send('evm_mine')

      await rentals.connect(lessor).setOperator(erc721.address, tokenId, newOperator)
    })

    it('should revert when the asset has never been rented', async () => {
      const setOperatorByLessor = rentals.connect(lessor).setOperator(erc721.address, tokenId, newOperator)
      const setOperatorByTenant = rentals.connect(tenant).setOperator(erc721.address, tokenId, newOperator)

      await expect(setOperatorByLessor).to.be.revertedWith('Rentals#setOperator: CANNOT_UPDATE_OPERATOR')
      await expect(setOperatorByTenant).to.be.revertedWith('Rentals#setOperator: CANNOT_UPDATE_OPERATOR')
    })

    it('should revert when the tenant tries to update the operator after the rent is over', async () => {
      await rentals.connect(lessor).acceptOffer({ ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) })

      await network.provider.send('evm_increaseTime', [daysToSeconds(tenantParams.rentalDays)])
      await network.provider.send('evm_mine')

      const setOperator = rentals.connect(tenant).setOperator(erc721.address, tokenId, newOperator)

      await expect(setOperator).to.be.revertedWith('Rentals#setOperator: CANNOT_UPDATE_OPERATOR')
    })

    it('should revert when the lessor tries to update the operator before the rental ends', async () => {
      await rentals.connect(lessor).acceptOffer({ ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) })

      const setOperator = rentals.connect(lessor).setOperator(erc721.address, tokenId, newOperator)

      await expect(setOperator).to.be.revertedWith('Rentals#setOperator: CANNOT_UPDATE_OPERATOR')
    })
  })

  describe('onERC721Received', () => {
    beforeEach(async () => {
      await rentals.connect(deployer).initialize(owner.address, erc20.address, collector.address, fee)
    })

    it('should allow the asset transfer from a rent', async () => {
      expect(await erc721.ownerOf(tokenId)).to.equal(lessor.address)

      await rentals.connect(lessor).acceptOffer({ ...tenantParams, signature: await getTenantSignature(tenant, rentals, tenantParams) })

      expect(await erc721.ownerOf(tokenId)).to.equal(rentals.address)
    })

    it('should revert when the contract receives an asset not transfered via rent', async () => {
      const transfer = erc721.connect(lessor)['safeTransferFrom(address,address,uint256)'](lessor.address, rentals.address, tokenId)
      await expect(transfer).to.be.revertedWith('Rentals#onERC721Received: ONLY_ACCEPT_TRANSFERS_FROM_THIS_CONTRACT')
    })
  })
})
