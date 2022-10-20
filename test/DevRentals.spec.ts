import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber } from 'ethers'
import { ethers } from 'hardhat'
import { DevRentals, LANDRegistry, MANAToken, Rentals } from '../typechain-types'
import { ether, getOfferSignature, getZeroBytes32, now } from './utils/rentals'

const zeroAddress = '0x0000000000000000000000000000000000000000'
const maxUint256 = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
const fee = '100000' // 10% fee

describe('DevRentals', () => {
  let deployer: SignerWithAddress
  let owner: SignerWithAddress
  let tenant: SignerWithAddress
  let lessor: SignerWithAddress
  let operator: SignerWithAddress
  let collector: SignerWithAddress
  let rentals: DevRentals
  let land: LANDRegistry
  let tokenId: BigNumber
  let mana: MANAToken
  let offerParams: Omit<Rentals.OfferStruct, 'signature'>

  beforeEach(async () => {
    // Store addresses
    ;[deployer, owner, tenant, lessor, operator, collector] = await ethers.getSigners()

    // Deploy Rentals contract
    const DevRentalsFactory = await ethers.getContractFactory('DevRentals')
    const devRentalsImpl = await DevRentalsFactory.connect(deployer).deploy()
    const rentalsProxyFactory = await ethers.getContractFactory('RentalsProxy')
    const rentalsProxy = await rentalsProxyFactory.connect(deployer).deploy(devRentalsImpl.address)

    rentals = await ethers.getContractAt('DevRentals', rentalsProxy.address)

    // Deploy and Prepare LANDRegistry
    const LANDRegistryFactory = await ethers.getContractFactory('LANDRegistry')
    const landRegistry = await LANDRegistryFactory.connect(deployer).deploy()
    const LANDProxyFactory = await ethers.getContractFactory('LANDProxy')
    const landProxy = await LANDProxyFactory.connect(deployer).deploy()
    await landProxy.connect(deployer).upgrade(landRegistry.address, [])

    land = await ethers.getContractAt('LANDRegistry', landProxy.address)

    await land.connect(deployer).assignNewParcel(0, 0, lessor.address)
    await land.connect(lessor).setApprovalForAll(rentals.address, true)

    tokenId = await land.encodeTokenId(0, 0)

    // Deploy and Prepare MANAToken
    const MANATokenFactory = await ethers.getContractFactory('MANAToken')

    mana = await MANATokenFactory.connect(deployer).deploy()

    await mana.connect(deployer).mint(tenant.address, ether('100000'))
    await mana.connect(tenant).approve(rentals.address, maxUint256)

    offerParams = {
      signer: tenant.address,
      contractAddress: land.address,
      tokenId,
      fingerprint: getZeroBytes32(),
      pricePerDay: ether('100'),
      expiration: now() + 1000,
      indexes: [0, 0, 0],
      rentalDays: 15,
      operator: operator.address,
    }
  })

  describe('returnToLessor ', () => {
    beforeEach(async () => {
      await rentals.initialize(owner.address, mana.address, collector.address, fee)
    })

    it('should return the asset to the lessor', async () => {
      // Check state before accept offer
      let rental = await rentals.getRental(offerParams.contractAddress, offerParams.tokenId)
      expect(rental.lessor).to.be.equal(zeroAddress)
      expect(rental.tenant).to.be.equal(zeroAddress)
      expect(rental.endDate).to.be.equal(zeroAddress)
      expect(await land.ownerOf(tokenId)).to.be.equal(lessor.address)

      // Accept offer
      await rentals.connect(lessor).acceptOffer({ ...offerParams, signature: await getOfferSignature(tenant, rentals as any, offerParams) })

      // Check state after accept offer
      rental = await rentals.getRental(offerParams.contractAddress, offerParams.tokenId)
      expect(rental.lessor).to.be.equal(lessor.address)
      expect(rental.tenant).to.be.equal(tenant.address)
      expect(rental.endDate).to.not.be.equal(zeroAddress)
      expect(await land.ownerOf(tokenId)).to.be.equal(rentals.address)

      // Return to lessor
      await rentals.connect(owner).returnToLessor([offerParams.contractAddress], [offerParams.tokenId])

      // Check state after return to lessor
      rental = await rentals.getRental(offerParams.contractAddress, offerParams.tokenId)
      expect(rental.lessor).to.be.equal(zeroAddress)
      expect(rental.tenant).to.be.equal(zeroAddress)
      expect(rental.endDate).to.be.equal(zeroAddress)
      expect(await land.ownerOf(tokenId)).to.be.equal(lessor.address)
    })

    it('reverts when the asset is not in the rentals mapping', async () => {
      await expect(rentals.connect(owner).returnToLessor([land.address], [tokenId])).to.be.revertedWith(
        'ExtendedRentals#returnToLessor: ASSET_NOT_IN_CONTRACT'
      )
    })

    it('reverts when the arrays have different length', async () => {
      await expect(rentals.connect(owner).returnToLessor([land.address], [])).to.be.revertedWith('ExtendedRentals#returnToLessor: LENGTH_MISMATCH')

      await expect(rentals.connect(owner).returnToLessor([], [tokenId])).to.be.revertedWith('ExtendedRentals#returnToLessor: LENGTH_MISMATCH')

      await expect(rentals.connect(owner).returnToLessor([land.address], [tokenId, tokenId])).to.be.revertedWith(
        'ExtendedRentals#returnToLessor: LENGTH_MISMATCH'
      )

      await expect(rentals.connect(owner).returnToLessor([land.address, land.address], [tokenId])).to.be.revertedWith(
        'ExtendedRentals#returnToLessor: LENGTH_MISMATCH'
      )
    })
  })
})
