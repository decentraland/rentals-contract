import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, BigNumberish } from 'ethers'
import { ethers, network } from 'hardhat'
import { DummyComposableERC721, DummyERC20, DummyERC721 } from '../typechain-types'
import { Rentals } from '../typechain-types/Rentals'
import {
  daysToSeconds,
  ether,
  getListingSignature,
  getMetaTxSignature,
  getRandomBytes32,
  getBidSignature,
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
  let listingParams: Omit<Rentals.ListingStruct, 'signature'>
  let bidParams: Omit<Rentals.BidStruct, 'signature'>
  let acceptListingParams: Pick<typeof bidParams, 'operator' | 'rentalDays' | 'fingerprint'> & { index: BigNumberish }
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

    listingParams = {
      signer: lessor.address,
      contractAddress: erc721.address,
      tokenId,
      expiration: now() + 1000,
      nonces: [0, 0, 0],
      pricePerDay: [ether('100')],
      maxDays: [20],
      minDays: [10],
    }

    bidParams = {
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

    acceptListingParams = {
      operator: bidParams.operator,
      index: 0,
      rentalDays: bidParams.rentalDays,
      fingerprint: bidParams.fingerprint,
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

  describe('isRented', () => {
    beforeEach(async () => {
      await rentals.connect(deployer).initialize(owner.address, erc20.address, collector.address, fee)
    })

    it('should return false when the asset was never rented', async () => {
      expect(await rentals.connect(lessor).isRented(erc721.address, tokenId)).to.equal(false)
    })

    it('should return true after an asset is rented', async () => {
      await rentals.connect(lessor).acceptBid({ ...bidParams, signature: await getBidSignature(tenant, rentals, bidParams) })

      expect(await rentals.connect(lessor).isRented(erc721.address, tokenId)).to.equal(true)
    })

    it('should return false after and asset is rented and enough time passes to surpass the rental end time', async () => {
      await rentals.connect(lessor).acceptBid({ ...bidParams, signature: await getBidSignature(tenant, rentals, bidParams) })

      await network.provider.send('evm_increaseTime', [daysToSeconds(bidParams.rentalDays)])
      await network.provider.send('evm_mine')

      expect(await rentals.connect(lessor).isRented(erc721.address, tokenId)).to.equal(false)
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
            { ...listingParams, signature: await getListingSignature(lessor, rentals, listingParams) },
            acceptListingParams.operator,
            acceptListingParams.index,
            acceptListingParams.rentalDays,
            acceptListingParams.fingerprint
          )
      )
        .to.emit(rentals, 'RentalStarted')
        .withArgs(
          bidParams.contractAddress,
          bidParams.tokenId,
          listingParams.signer,
          bidParams.signer,
          bidParams.operator,
          bidParams.rentalDays,
          bidParams.pricePerDay,
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
        .withArgs(0, 1, bidParams.contractAddress, bidParams.tokenId, bidParams.signer, tenant.address)
    })

    it('should allow the tenant to select a different option included in the tenant signature by providing a different index', async () => {
      listingParams.pricePerDay = [...listingParams.pricePerDay, ether('20')]
      listingParams.maxDays = [...listingParams.maxDays, 30]
      listingParams.minDays = [...listingParams.minDays, 20]

      bidParams.pricePerDay = ether('20')
      bidParams.rentalDays = 25

      const index = 1

      const rent = rentals
        .connect(tenant)
        .acceptListing(
          { ...listingParams, signature: await getListingSignature(lessor, rentals, listingParams) },
          bidParams.operator,
          index,
          bidParams.rentalDays,
          bidParams.fingerprint
        )

      await expect(rent)
        .to.emit(rentals, 'RentalStarted')
        .withArgs(
          bidParams.contractAddress,
          bidParams.tokenId,
          listingParams.signer,
          bidParams.signer,
          bidParams.operator,
          bidParams.rentalDays,
          bidParams.pricePerDay,
          tenant.address
        )
    })

    it('should update the lessors mappingwith lessor when the contract does not own the asset already', async () => {
      expect(await rentals.connect(lessor).lessors(erc721.address, tokenId)).to.equal(zeroAddress)

      await rentals
        .connect(tenant)
        .acceptListing(
          { ...listingParams, signature: await getListingSignature(lessor, rentals, listingParams) },
          acceptListingParams.operator,
          acceptListingParams.index,
          acceptListingParams.rentalDays,
          acceptListingParams.fingerprint
        )

      expect(await rentals.connect(tenant).lessors(erc721.address, tokenId)).to.equal(lessor.address)
    })

    it('should bump both the lessor and tenant asset nonces', async () => {
      expect(await rentals.connect(lessor).assetNonce(erc721.address, tokenId, lessor.address)).to.equal(0)
      expect(await rentals.connect(lessor).assetNonce(erc721.address, tokenId, tenant.address)).to.equal(0)

      await rentals
        .connect(tenant)
        .acceptListing(
          { ...listingParams, signature: await getListingSignature(lessor, rentals, listingParams) },
          acceptListingParams.operator,
          acceptListingParams.index,
          acceptListingParams.rentalDays,
          acceptListingParams.fingerprint
        )

      expect(await rentals.connect(lessor).assetNonce(erc721.address, tokenId, lessor.address)).to.equal(1)
      expect(await rentals.connect(lessor).assetNonce(erc721.address, tokenId, tenant.address)).to.equal(1)
    })

    it('should update the ongoing rentals mapping for the rented asset', async () => {
      expect(await rentals.connect(lessor).rentals(erc721.address, tokenId)).to.equal(0)

      const latestBlock = await ethers.provider.getBlock('latest')
      const latestBlockTime = latestBlock.timestamp

      await rentals
        .connect(tenant)
        .acceptListing(
          { ...listingParams, signature: await getListingSignature(lessor, rentals, listingParams) },
          acceptListingParams.operator,
          acceptListingParams.index,
          acceptListingParams.rentalDays,
          acceptListingParams.fingerprint
        )

      expect(await rentals.connect(lessor).rentals(erc721.address, tokenId)).to.equal(latestBlockTime + daysToSeconds(bidParams.rentalDays) + 1)
    })

    it('should not transfer erc20 when price per day is 0', async () => {
      const originalBalanceTenant = await erc20.balanceOf(tenant.address)
      const originalBalanceLessor = await erc20.balanceOf(lessor.address)
      const originalBalanceCollector = await erc20.balanceOf(collector.address)

      listingParams.pricePerDay = ['0']
      bidParams.pricePerDay = '0'

      await rentals
        .connect(tenant)
        .acceptListing(
          { ...listingParams, signature: await getListingSignature(lessor, rentals, listingParams) },
          acceptListingParams.operator,
          acceptListingParams.index,
          acceptListingParams.rentalDays,
          acceptListingParams.fingerprint
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
          { ...listingParams, signature: await getListingSignature(lessor, rentals, listingParams) },
          acceptListingParams.operator,
          acceptListingParams.index,
          acceptListingParams.rentalDays,
          acceptListingParams.fingerprint
        )

      const total = BigNumber.from(bidParams.pricePerDay).mul(bidParams.rentalDays)
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
          { ...listingParams, signature: await getListingSignature(lessor, rentals, listingParams) },
          acceptListingParams.operator,
          acceptListingParams.index,
          acceptListingParams.rentalDays,
          acceptListingParams.fingerprint
        )

      const total = BigNumber.from(bidParams.pricePerDay).mul(bidParams.rentalDays)

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
          { ...listingParams, signature: await getListingSignature(lessor, rentals, listingParams) },
          acceptListingParams.operator,
          acceptListingParams.index,
          acceptListingParams.rentalDays,
          acceptListingParams.fingerprint
        )

      const total = BigNumber.from(bidParams.pricePerDay).mul(bidParams.rentalDays)

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
          bidParams.contractAddress,
          bidParams.tokenId,
          listingParams.signer,
          bidParams.signer,
          bidParams.operator,
          bidParams.rentalDays,
          bidParams.pricePerDay,
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
      ).to.be.revertedWith('Rentals#acceptListing: CONTRACT_NONCE_MISSMATCH')
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
      ).to.be.revertedWith('Rentals#acceptListing: SIGNER_NONCE_MISSMATCH')
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
      ).to.be.revertedWith('Rentals#acceptListing: ASSET_NONCE_MISSMATCH')
    })

    it("should revert when the provided contract address's `verifyFingerprint` returns false", async () => {
      const DummyFalseVerifyFingerprintFactory = await ethers.getContractFactory('DummyFalseVerifyFingerprint')
      const falseVerifyFingerprint = await DummyFalseVerifyFingerprintFactory.connect(deployer).deploy()

      listingParams = { ...listingParams, contractAddress: falseVerifyFingerprint.address }

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
      ).to.be.revertedWith('Rentals#rent: INVALID_FINGERPRINT')
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
      ).to.be.revertedWith('Rentals#rent: CURRENTLY_RENTED')
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

      await network.provider.send('evm_increaseTime', [daysToSeconds(acceptListingParams.rentalDays)])
      await network.provider.send('evm_mine')

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
      ).to.be.revertedWith('Rentals#rent: NOT_ORIGINAL_OWNER')
    })
  })

  describe('acceptBid', () => {
    beforeEach(async () => {
      await rentals.connect(deployer).initialize(owner.address, erc20.address, collector.address, fee)
    })

    it('should emit a RentalStarted event', async () => {
      await expect(rentals.connect(lessor).acceptBid({ ...bidParams, signature: await getBidSignature(tenant, rentals, bidParams) }))
        .to.emit(rentals, 'RentalStarted')
        .withArgs(
          bidParams.contractAddress,
          bidParams.tokenId,
          listingParams.signer,
          bidParams.signer,
          bidParams.operator,
          bidParams.rentalDays,
          bidParams.pricePerDay,
          lessor.address
        )
    })

    it('should emit an AssetNonceUpdated event for the lessor and the tenant', async () => {
      await expect(rentals.connect(lessor).acceptBid({ ...bidParams, signature: await getBidSignature(tenant, rentals, bidParams) }))
        .to.emit(rentals, 'AssetNonceUpdated')
        .withArgs(0, 1, listingParams.contractAddress, listingParams.tokenId, listingParams.signer, lessor.address)
        .to.emit(rentals, 'AssetNonceUpdated')
        .withArgs(0, 1, bidParams.contractAddress, bidParams.tokenId, bidParams.signer, lessor.address)
    })

    it('should update lessors mapping with lessor when the contract does not own the asset already', async () => {
      expect(await rentals.connect(lessor).lessors(erc721.address, tokenId)).to.equal(zeroAddress)

      await rentals.connect(lessor).acceptBid({ ...bidParams, signature: await getBidSignature(tenant, rentals, bidParams) })

      expect(await rentals.connect(lessor).lessors(erc721.address, tokenId)).to.equal(lessor.address)
    })

    it('should bump both the lessor and tenant asset nonces', async () => {
      expect(await rentals.connect(lessor).assetNonce(erc721.address, tokenId, lessor.address)).to.equal(0)
      expect(await rentals.connect(lessor).assetNonce(erc721.address, tokenId, tenant.address)).to.equal(0)

      await rentals.connect(lessor).acceptBid({ ...bidParams, signature: await getBidSignature(tenant, rentals, bidParams) })

      expect(await rentals.connect(lessor).assetNonce(erc721.address, tokenId, lessor.address)).to.equal(1)
      expect(await rentals.connect(lessor).assetNonce(erc721.address, tokenId, tenant.address)).to.equal(1)
    })

    it('should update the rentals mapping for the rented asset with the rental finish timestamp', async () => {
      expect(await rentals.connect(lessor).rentals(erc721.address, tokenId)).to.equal(0)

      const latestBlock = await ethers.provider.getBlock('latest')
      const latestBlockTime = latestBlock.timestamp

      await rentals.connect(lessor).acceptBid({ ...bidParams, signature: await getBidSignature(tenant, rentals, bidParams) })

      expect(await rentals.connect(lessor).rentals(erc721.address, tokenId)).to.equal(latestBlockTime + daysToSeconds(bidParams.rentalDays) + 1)
    })

    it('should not transfer erc20 when price per day is 0', async () => {
      const originalBalanceTenant = await erc20.balanceOf(tenant.address)
      const originalBalanceLessor = await erc20.balanceOf(lessor.address)
      const originalBalanceCollector = await erc20.balanceOf(collector.address)

      bidParams.pricePerDay = '0'

      await rentals.connect(lessor).acceptBid({ ...bidParams, signature: await getBidSignature(tenant, rentals, bidParams) })

      expect(await erc20.balanceOf(tenant.address)).to.equal(originalBalanceTenant)
      expect(await erc20.balanceOf(lessor.address)).to.equal(originalBalanceLessor)
      expect(await erc20.balanceOf(collector.address)).to.equal(originalBalanceCollector)
    })

    it('should transfer erc20 from the tenant to the lessor and collector', async () => {
      const originalBalanceTenant = await erc20.balanceOf(tenant.address)
      const originalBalanceLessor = await erc20.balanceOf(lessor.address)
      const originalBalanceCollector = await erc20.balanceOf(collector.address)

      await rentals.connect(lessor).acceptBid({ ...bidParams, signature: await getBidSignature(tenant, rentals, bidParams) })

      const total = BigNumber.from(bidParams.pricePerDay).mul(bidParams.rentalDays)
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

      await rentals.connect(lessor).acceptBid({ ...bidParams, signature: await getBidSignature(tenant, rentals, bidParams) })

      const total = BigNumber.from(bidParams.pricePerDay).mul(bidParams.rentalDays)

      expect(await erc20.balanceOf(tenant.address)).to.equal(originalBalanceTenant.sub(total))
      expect(await erc20.balanceOf(lessor.address)).to.equal(originalBalanceLessor.add(total))
      expect(await erc20.balanceOf(collector.address)).to.equal(originalBalanceCollector)
    })

    it('should not transfer erc20 to lessor when fee is 1_000_000', async () => {
      const originalBalanceTenant = await erc20.balanceOf(tenant.address)
      const originalBalanceLessor = await erc20.balanceOf(lessor.address)
      const originalBalanceCollector = await erc20.balanceOf(collector.address)

      await rentals.connect(owner).setFee('1000000')

      await rentals.connect(lessor).acceptBid({ ...bidParams, signature: await getBidSignature(tenant, rentals, bidParams) })

      const total = BigNumber.from(bidParams.pricePerDay).mul(bidParams.rentalDays)

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
              internalType: 'struct Rentals.Bid',
              name: '_bid',
              type: 'tuple',
            },
          ],
          name: 'acceptBid',
          outputs: [],
          stateMutability: 'nonpayable',
          type: 'function',
        },
      ]

      const iface = new ethers.utils.Interface(abi)
      const functionData = iface.encodeFunctionData('acceptBid', [{ ...bidParams, signature: await getBidSignature(tenant, rentals, bidParams) }])
      const metaTxSignature = await getMetaTxSignature(lessor, rentals, functionData)

      const rent = rentals.connect(lessor).executeMetaTransaction(lessor.address, functionData, metaTxSignature)

      await expect(rent)
        .to.emit(rentals, 'RentalStarted')
        .withArgs(
          bidParams.contractAddress,
          bidParams.tokenId,
          listingParams.signer,
          bidParams.signer,
          bidParams.operator,
          bidParams.rentalDays,
          bidParams.pricePerDay,
          lessor.address
        )
    })

    it('should revert when the tenant signer does not match the signer provided in params', async () => {
      await expect(
        rentals
          .connect(lessor)
          .acceptBid({ ...bidParams, signature: await getBidSignature(tenant, rentals, { ...bidParams, signer: lessor.address }) })
      ).to.be.revertedWith('Rentals#acceptBid: SIGNATURE_MISSMATCH')
    })

    it('should revert when lessor is same as tenant', async () => {
      bidParams = { ...bidParams, signer: lessor.address }

      await expect(
        rentals.connect(lessor).acceptBid({ ...bidParams, signature: await getBidSignature(lessor, rentals, bidParams) })
      ).to.be.revertedWith('Rentals#acceptBid: CALLER_CANNOT_BE_SIGNER')
    })

    it('should revert when the block timestamp is higher than the provided tenant signature expiration', async () => {
      bidParams = { ...bidParams, expiration: now() - 1000 }

      await expect(
        rentals.connect(lessor).acceptBid({ ...bidParams, signature: await getBidSignature(tenant, rentals, bidParams) })
      ).to.be.revertedWith('Rentals#acceptBid: EXPIRED_SIGNATURE')
    })

    it('should revert when tenant rental days is zero', async () => {
      bidParams = { ...bidParams, rentalDays: 0 }

      await expect(
        rentals.connect(lessor).acceptBid({ ...bidParams, signature: await getBidSignature(tenant, rentals, bidParams) })
      ).to.be.revertedWith('Rentals#acceptBid: RENTAL_DAYS_IS_ZERO')
    })

    it('should revert when tenant contract nonce is not the same as the contract', async () => {
      bidParams = { ...bidParams, nonces: [1, 0, 0] }

      await expect(
        rentals.connect(lessor).acceptBid({ ...bidParams, signature: await getBidSignature(tenant, rentals, bidParams) })
      ).to.be.revertedWith('Rentals#acceptBid: CONTRACT_NONCE_MISSMATCH')
    })

    it('should revert when tenant signer nonce is not the same as the contract', async () => {
      bidParams = { ...bidParams, nonces: [0, 1, 0] }

      await expect(
        rentals.connect(lessor).acceptBid({ ...bidParams, signature: await getBidSignature(tenant, rentals, bidParams) })
      ).to.be.revertedWith('Rentals#acceptBid: SIGNER_NONCE_MISSMATCH')
    })

    it('should revert when tenant asset nonce is not the same as the contract', async () => {
      bidParams = { ...bidParams, nonces: [0, 0, 1] }

      await expect(
        rentals.connect(lessor).acceptBid({ ...bidParams, signature: await getBidSignature(tenant, rentals, bidParams) })
      ).to.be.revertedWith('Rentals#acceptBid: ASSET_NONCE_MISSMATCH')
    })

    it("should revert when the provided contract address's `verifyFingerprint` returns false", async () => {
      const DummyFalseVerifyFingerprintFactory = await ethers.getContractFactory('DummyFalseVerifyFingerprint')
      const falseVerifyFingerprint = await DummyFalseVerifyFingerprintFactory.connect(deployer).deploy()

      bidParams = { ...bidParams, contractAddress: falseVerifyFingerprint.address, fingerprint: getRandomBytes32() }

      await expect(
        rentals.connect(lessor).acceptBid({ ...bidParams, signature: await getBidSignature(tenant, rentals, bidParams) })
      ).to.be.revertedWith('Rentals#rent: INVALID_FINGERPRINT')
    })

    it('should revert if an asset is already being rented', async () => {
      rentals.connect(lessor).acceptBid({ ...bidParams, signature: await getBidSignature(tenant, rentals, bidParams) })

      listingParams = { ...listingParams, nonces: [0, 0, 1] }
      bidParams = { ...bidParams, nonces: [0, 0, 1] }

      await expect(
        rentals.connect(lessor).acceptBid({ ...bidParams, signature: await getBidSignature(tenant, rentals, bidParams) })
      ).to.be.revertedWith('Rentals#rent: CURRENTLY_RENTED')
    })

    it('should revert if someone other than the original owner wants to rent an asset currently owned by the contract', async () => {
      await rentals.connect(lessor).acceptBid({ ...bidParams, signature: await getBidSignature(tenant, rentals, bidParams) })

      await network.provider.send('evm_increaseTime', [daysToSeconds(bidParams.rentalDays)])
      await network.provider.send('evm_mine')

      bidParams = { ...bidParams, expiration: maxUint256, nonces: [0, 0, 1] }

      await expect(
        rentals.connect(extra).acceptBid({ ...bidParams, signature: await getBidSignature(tenant, rentals, bidParams) })
      ).to.be.revertedWith('Rentals#rent: NOT_ORIGINAL_OWNER')
    })
  })

  describe('claim', () => {
    beforeEach(async () => {
      await rentals.connect(deployer).initialize(owner.address, erc20.address, collector.address, fee)
    })

    it('should set the original owner to address(0)', async () => {
      await rentals.connect(lessor).acceptBid({ ...bidParams, signature: await getBidSignature(tenant, rentals, bidParams) })

      await network.provider.send('evm_increaseTime', [daysToSeconds(bidParams.rentalDays)])
      await network.provider.send('evm_mine')

      await rentals.connect(lessor).claim(erc721.address, tokenId)

      expect(await rentals.lessors(erc721.address, tokenId)).to.equal(zeroAddress)
    })

    it('should transfer the asset to the original owner', async () => {
      await rentals.connect(lessor).acceptBid({ ...bidParams, signature: await getBidSignature(tenant, rentals, bidParams) })

      await network.provider.send('evm_increaseTime', [daysToSeconds(bidParams.rentalDays)])
      await network.provider.send('evm_mine')

      expect(await erc721.ownerOf(tokenId)).to.equal(rentals.address)

      await rentals.connect(lessor).claim(erc721.address, tokenId)

      expect(await erc721.ownerOf(tokenId)).to.equal(lessor.address)
    })

    it('should emit an AssetClaimed event', async () => {
      await rentals.connect(lessor).acceptBid({ ...bidParams, signature: await getBidSignature(tenant, rentals, bidParams) })

      await network.provider.send('evm_increaseTime', [daysToSeconds(bidParams.rentalDays)])
      await network.provider.send('evm_mine')

      await expect(rentals.connect(lessor).claim(erc721.address, tokenId))
        .to.emit(rentals, 'AssetClaimed')
        .withArgs(erc721.address, tokenId, lessor.address)
    })

    it('should accept a meta tx', async () => {
      await rentals.connect(lessor).acceptBid({ ...bidParams, signature: await getBidSignature(tenant, rentals, bidParams) })

      await network.provider.send('evm_increaseTime', [daysToSeconds(bidParams.rentalDays)])
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
      await rentals.connect(lessor).acceptBid({ ...bidParams, signature: await getBidSignature(tenant, rentals, bidParams) })

      await expect(rentals.connect(lessor).claim(erc721.address, tokenId)).to.be.revertedWith('Rentals#claim: CURRENTLY_RENTED')
    })

    it('should revert when the caller is not the original owner of the asset', async () => {
      await rentals.connect(lessor).acceptBid({ ...bidParams, signature: await getBidSignature(tenant, rentals, bidParams) })

      await network.provider.send('evm_increaseTime', [daysToSeconds(bidParams.rentalDays)])
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
      await rentals.connect(lessor).acceptBid({ ...bidParams, signature: await getBidSignature(tenant, rentals, bidParams) })

      await rentals.connect(tenant).setOperator(erc721.address, tokenId, newOperator)
    })

    it('should allow the lessor to update the asset operator after the rent is over', async () => {
      await rentals.connect(lessor).acceptBid({ ...bidParams, signature: await getBidSignature(tenant, rentals, bidParams) })

      await network.provider.send('evm_increaseTime', [daysToSeconds(bidParams.rentalDays)])
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
      await rentals.connect(lessor).acceptBid({ ...bidParams, signature: await getBidSignature(tenant, rentals, bidParams) })

      await network.provider.send('evm_increaseTime', [daysToSeconds(bidParams.rentalDays)])
      await network.provider.send('evm_mine')

      const setOperator = rentals.connect(tenant).setOperator(erc721.address, tokenId, newOperator)

      await expect(setOperator).to.be.revertedWith('Rentals#setOperator: CANNOT_UPDATE_OPERATOR')
    })

    it('should revert when the lessor tries to update the operator before the rental ends', async () => {
      await rentals.connect(lessor).acceptBid({ ...bidParams, signature: await getBidSignature(tenant, rentals, bidParams) })

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

      await rentals.connect(lessor).acceptBid({ ...bidParams, signature: await getBidSignature(tenant, rentals, bidParams) })

      expect(await erc721.ownerOf(tokenId)).to.equal(rentals.address)
    })

    it('should revert when the contract receives an asset not transfered via rent', async () => {
      const transfer = erc721.connect(lessor)['safeTransferFrom(address,address,uint256)'](lessor.address, rentals.address, tokenId)
      await expect(transfer).to.be.revertedWith('Rentals#onERC721Received: ONLY_ACCEPT_TRANSFERS_FROM_THIS_CONTRACT')
    })
  })
})
