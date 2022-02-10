import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { ethers } from 'hardhat'
import { Rentals } from '../typechain-types/Rentals'
import { getRenterSignature, getTenantSignature } from './utils/rentals'

describe('Rentals', () => {
  let deployer: SignerWithAddress
  let owner: SignerWithAddress
  let renter: SignerWithAddress
  let tenant: SignerWithAddress
  let rentals: Rentals

  beforeEach(async () => {
    // Store addresses
    ;[deployer, owner, renter, tenant] = await ethers.getSigners()

    // Deploy Rentals contract
    const RentalsFactory = await ethers.getContractFactory('Rentals')
    rentals = await RentalsFactory.connect(deployer).deploy()
  })

  describe('initialize', () => {
    it('should set the owner', async () => {
      await rentals.connect(deployer).initialize(owner.address)
      const rentalsOwner = await rentals.owner()
      expect(rentalsOwner).to.be.equal(owner.address)
    })

    it('should revert when initialized more than once', async () => {
      await rentals.connect(deployer).initialize(owner.address)
      await expect(rentals.connect(deployer).initialize(owner.address)).to.be.revertedWith(
        'Initializable: contract is already initialized'
      )
    })
  })

  describe('rent', () => {
    let renterParams: any
    let tenantParams: any

    beforeEach(() => {
      renterParams = {
        renter: renter.address,
        maxDays: '0',
        price: '0',
        expiration: '0',
        _contract: rentals.address,
        tokenId: '0',
        salt: ethers.utils.randomBytes(32),
      }

      tenantParams = {
        tenant: tenant.address,
        _days: '0',
        expiration: '0',
        _contract: rentals.address,
        tokenId: '0',
        salt: ethers.utils.randomBytes(32),
      }
    })
    it('should add both the tenant and renter signatures to the isRejectedSignature mapping', async () => {
      const renterSignature = await getRenterSignature(renter, rentals, renterParams)
      const tenantSignature = await getTenantSignature(tenant, rentals, tenantParams)

      await rentals.connect(deployer).initialize(owner.address)

      await rentals.rent({ ...renterParams, sig: renterSignature }, { ...tenantParams, sig: tenantSignature })

      const res = await Promise.all([
        rentals.isSignatureRejected(renterSignature),
        rentals.isSignatureRejected(tenantSignature),
      ])

      expect(res.every((isRejected) => isRejected)).to.be.true
    })

    it('should revert when the recovered renter is not the same as in the params', async () => {
      const renterSignature = await getRenterSignature(renter, rentals, { ...renterParams, maxDays: '100' })
      const tenantSignature = await getTenantSignature(tenant, rentals, tenantParams)

      await rentals.connect(deployer).initialize(owner.address)

      await expect(
        rentals.rent({ ...renterParams, sig: renterSignature }, { ...tenantParams, sig: tenantSignature })
      ).to.be.revertedWith('Rentals#rent: SIGNER_NOT_RENTER')
    })

    it('should revert when the recovered tenant is not the same as in the params', async () => {
      const renterSignature = await getRenterSignature(renter, rentals, renterParams)
      const tenantSignature = await getTenantSignature(tenant, rentals, { ...tenantParams, _days: '100' })

      await rentals.connect(deployer).initialize(owner.address)

      await expect(
        rentals.rent({ ...renterParams, sig: renterSignature }, { ...tenantParams, sig: tenantSignature })
      ).to.be.revertedWith('Rentals#rent: SIGNER_NOT_TENANT')
    })
  })

  describe('rejectSignatures', () => {
    let sig: string

    beforeEach(async () => {
      sig = '0x7369676e6174757265' // Hex for "signature"
    })

    it('should set isSignatureRejected mapping value for the provided signature to true', async () => {
      await rentals.connect(deployer).initialize(owner.address)
      await rentals.rejectSignatures([sig])
      const isSignatureRejected = await rentals.isSignatureRejected(sig)
      expect(isSignatureRejected).to.be.true
    })

    it('should set isSignatureRejected mapping value for all the provided signatures to true', async () => {
      await rentals.connect(deployer).initialize(owner.address)
      const anotherSig = '0x616e6f746865722d7369676e6174757265' // Hex for another-signature
      await rentals.rejectSignatures([sig, anotherSig])
      const res = await Promise.all([rentals.isSignatureRejected(sig), rentals.isSignatureRejected(anotherSig)])
      expect(res.every((isRejected) => isRejected)).to.be.true
    })

    it('should revert when no signatures are provided', async () => {
      await rentals.connect(deployer).initialize(owner.address)
      await expect(rentals.rejectSignatures([])).to.be.revertedWith('Rentals#rejectSignatures: EMPTY_SIGNATURE_ARRAY')
    })

    it('should revert when the signature was already rejected', async () => {
      await rentals.connect(deployer).initialize(owner.address)
      await rentals.rejectSignatures([sig])
      await expect(rentals.rejectSignatures([sig])).to.be.revertedWith('Rentals#rejectSignature: ALREADY_REJECTED')
    })
  })
})
