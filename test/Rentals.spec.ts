import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { ethers } from 'hardhat'
import { Rentals } from '../typechain-types/Rentals'

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
    it('should reject both renter and tenant signatures', async () => {
      const renterParams = {
        renter: renter.address,
        maxDays: '0',
        price: '0',
        expiration: '0',
        _contract: rentals.address,
        tokenId: '0',
        salt: ethers.utils.randomBytes(32),
      }

      const renterSignature = await renter._signTypedData(
        {
          chainId: 31337,
          name: 'Rentals',
          verifyingContract: rentals.address,
          version: '1',
        },
        {
          RenterSignData: [
            {
              type: 'address',
              name: 'renter',
            },
            {
              type: 'uint256',
              name: 'maxDays',
            },
            {
              type: 'uint256',
              name: 'price',
            },
            {
              type: 'uint256',
              name: 'expiration',
            },
            {
              type: 'address',
              name: '_contract',
            },
            {
              type: 'uint256',
              name: 'tokenId',
            },
            {
              type: 'bytes32',
              name: 'salt',
            },
          ],
        },
        renterParams
      )

      const tenantParams = {
        tenant: tenant.address,
        _days: '0',
        expiration: '0',
        _contract: rentals.address,
        tokenId: '0',
        salt: ethers.utils.randomBytes(32),
      }

      const tenantSignature = await tenant._signTypedData(
        {
          chainId: 31337,
          name: 'Rentals',
          verifyingContract: rentals.address,
          version: '1',
        },
        {
          TenantSignData: [
            {
              type: 'address',
              name: 'tenant',
            },
            {
              type: 'uint256',
              name: '_days',
            },
            {
              type: 'uint256',
              name: 'expiration',
            },
            {
              type: 'address',
              name: '_contract',
            },
            {
              type: 'uint256',
              name: 'tokenId',
            },
            {
              type: 'bytes32',
              name: 'salt',
            },
          ],
        },
        tenantParams
      )

      await rentals.connect(deployer).initialize(owner.address)

      await rentals.rent({ ...renterParams, sig: renterSignature }, { ...tenantParams, sig: tenantSignature })
      const res = await Promise.all([
        rentals.isSignatureRejected(renterSignature),
        rentals.isSignatureRejected(tenantSignature),
      ])
      expect(res.every((isRejected) => isRejected)).to.be.true
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
