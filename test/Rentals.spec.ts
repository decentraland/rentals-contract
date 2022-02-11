import { Block } from '@ethersproject/abstract-provider'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumberish } from 'ethers'
import { ethers } from 'hardhat'
import { DummyComposableERC721, DummyERC20, DummyERC721 } from '../typechain-types'
import { Rentals } from '../typechain-types/Rentals'
import { ether, getRandomSalt, getRandomSignature, getRenterSignature } from './utils/rentals'

describe('Rentals', () => {
  let deployer: SignerWithAddress
  let owner: SignerWithAddress
  let renter: SignerWithAddress
  let tenant: SignerWithAddress
  let rentals: Rentals
  let erc721: DummyERC721
  let composableErc721: DummyComposableERC721
  let erc20: DummyERC20

  beforeEach(async () => {
    // Store addresses
    ;[deployer, owner, renter, tenant] = await ethers.getSigners()

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
    it('should set the owner', async () => {
      await rentals.connect(deployer).initialize(owner.address, erc20.address)
      expect(await rentals.owner()).to.be.equal(owner.address)
    })

    it('should set the erc20 token', async () => {
      await rentals.connect(deployer).initialize(owner.address, erc20.address)
      expect(await rentals.erc20Token()).to.be.equal(erc20.address)
    })

    it('should revert when initialized more than once', async () => {
      await rentals.connect(deployer).initialize(owner.address, erc20.address)
      await expect(rentals.connect(deployer).initialize(owner.address, erc20.address)).to.be.revertedWith(
        'Initializable: contract is already initialized'
      )
    })
  })

  describe('rent', () => {
    let renterParams: any
    let days: number
    let latestBlock: Block
    let tokenId: BigNumberish

    beforeEach(async () => {
      await rentals.connect(deployer).initialize(owner.address, erc20.address)

      days = 10
      tokenId = 1
      latestBlock = await ethers.provider.getBlock('latest')

      renterParams = {
        renter: renter.address,
        maxDays: days,
        price: ethers.utils.parseUnits('10', 'ether'),
        expiration: latestBlock.timestamp + 100,
        tokenAddress: erc721.address,
        tokenId: tokenId,
        fingerprint: tokenId,
        salt: getRandomSalt(),
      }
    })

    it('should add the renter signature to the isRejectedSignature mapping', async () => {
      const renterSignature = await getRenterSignature(renter, rentals, renterParams)
      renterParams = { ...renterParams, sig: renterSignature }
      // Mint and Approve ERC721
      await erc721.mint(renter.address, tokenId)
      await erc721.connect(renter).approve(rentals.address, tokenId)
      // Mint and Approve ERC20
      await erc20.mint(tenant.address, ethers.utils.parseUnits('100', 'ether'))
      await erc20.connect(tenant).approve(rentals.address, ethers.utils.parseUnits('100', 'ether'))
      // Rent
      await rentals.connect(tenant).rent(renterParams, days)
      // Check the signature was added to the mapping
      expect(await rentals.isSignatureRejected(renterSignature)).to.be.true
    })

    it('should transfer the erc721 token from the renter to the contract', async () => {
      const renterSignature = await getRenterSignature(renter, rentals, renterParams)
      renterParams = { ...renterParams, sig: renterSignature }
      // Mint and Approve ERC721
      await erc721.mint(renter.address, tokenId)
      await erc721.connect(renter).approve(rentals.address, tokenId)
      // Mint and Approve ERC20
      await erc20.mint(tenant.address, ether('100'))
      await erc20.connect(tenant).approve(rentals.address, ether('100'))
      // Check renter is the owner of the NFT
      expect(await erc721.ownerOf(tokenId)).to.be.equal(renter.address)
      // Rent
      await rentals.connect(tenant).rent(renterParams, days)
      // Check rentals contract is the onwer of the NFT
      expect(await erc721.ownerOf(tokenId)).to.be.equal(rentals.address)
    })

    it('should transfer the composabble erc721 token from the renter to the contract', async () => {
      // Mint and Approve ERC721
      await composableErc721.mint(renter.address, tokenId)
      await composableErc721.connect(renter).approve(rentals.address, tokenId)
      // Mint and Approve ERC20
      await erc20.mint(tenant.address, ether('100'))
      await erc20.connect(tenant).approve(rentals.address, ether('100'))
      // Signature
      const fingerprint = await composableErc721.getFingerprint(tokenId)
      renterParams = { ...renterParams, tokenAddress: composableErc721.address, fingerprint }
      const renterSignature = await getRenterSignature(renter, rentals, renterParams)
      renterParams = { ...renterParams, sig: renterSignature }
      // Check renter is the owner of the NFT
      expect(await composableErc721.ownerOf(tokenId)).to.be.equal(renter.address)
      // Rent
      await rentals.connect(tenant).rent(renterParams, days)
      // Check rentals contract is the onwer of the NFT
      expect(await composableErc721.ownerOf(tokenId)).to.be.equal(rentals.address)
    })

    it('should transfer the erc20 token from the tenant to the renter', async () => {
      const renterSignature = await getRenterSignature(renter, rentals, renterParams)
      renterParams = { ...renterParams, sig: renterSignature }
      // Mint and Approve ERC721
      await erc721.mint(renter.address, tokenId)
      await erc721.connect(renter).approve(rentals.address, tokenId)
      // Mint and Approve ERC20
      await erc20.mint(tenant.address, ether('100'))
      await erc20.connect(tenant).approve(rentals.address, ether('100'))
      // Check renter and tenant ERC20 balances
      expect(await erc20.balanceOf(renter.address)).to.be.equal(0)
      expect(await erc20.balanceOf(tenant.address)).to.be.equal(ether('100'))
      // Rent
      await rentals.connect(tenant).rent(renterParams, days)
      // Check again the renter and tenant ERC20 balances
      expect(await erc20.balanceOf(renter.address)).to.be.equal(ether('10'))
      expect(await erc20.balanceOf(tenant.address)).to.be.equal(ether('90'))
    })

    it('should revert when the recovered renter is not the same as in the params', async () => {
      const renterSignature = await getRenterSignature(renter, rentals, { ...renterParams, maxDays: 100 })
      await expect(rentals.connect(tenant).rent({ ...renterParams, sig: renterSignature }, days)).to.be.revertedWith(
        'Rentals#rent: SIGNER_NOT_RENTER'
      )
    })

    it('should revert when the price == 0', async () => {
      renterParams = { ...renterParams, price: 0 }
      const renterSignature = await getRenterSignature(renter, rentals, renterParams)
      renterParams = { ...renterParams, sig: renterSignature }
      await expect(rentals.connect(tenant).rent(renterParams, days)).to.be.revertedWith('Rentals#rent: INVALID_PRICE')
    })

    it('should revert when the expiration is lower than the current time', async () => {
      renterParams = { ...renterParams, expiration: latestBlock.timestamp - 100 }
      const renterSignature = await getRenterSignature(renter, rentals, renterParams)
      renterParams = { ...renterParams, sig: renterSignature }
      await expect(rentals.connect(tenant).rent(renterParams, days)).to.be.revertedWith('Rentals#rent: EXPIRED')
    })

    it('should revert when _days > maxDays', async () => {
      days = 100
      const renterSignature = await getRenterSignature(renter, rentals, renterParams)
      renterParams = { ...renterParams, sig: renterSignature }
      await expect(rentals.connect(tenant).rent(renterParams, days)).to.be.revertedWith('Rentals#rent: TOO_MANY_DAYS')
    })

    it('should revert when _days == 0', async () => {
      days = 0
      const renterSignature = await getRenterSignature(renter, rentals, renterParams)
      renterParams = { ...renterParams, sig: renterSignature }
      await expect(rentals.connect(tenant).rent(renterParams, days)).to.be.revertedWith('Rentals#rent: ZERO_DAYS')
    })

    it('should revert when sender is the same as the renter', async () => {
      const renterSignature = await getRenterSignature(renter, rentals, renterParams)
      renterParams = { ...renterParams, sig: renterSignature }
      await expect(rentals.connect(renter).rent(renterParams, days)).to.be.revertedWith(
        'Rentals#rent: RENTER_CANNOT_BE_TENANT'
      )
    })
  })

  describe('rejectSignatures', () => {
    let sig: Uint8Array
    let anotherSig: Uint8Array

    beforeEach(async () => {
      sig = getRandomSignature()
      anotherSig = getRandomSignature()
      await rentals.connect(deployer).initialize(owner.address, erc20.address)
    })

    it('should set isSignatureRejected mapping value for the provided signature to true', async () => {
      await rentals.rejectSignatures([sig])
      const isSignatureRejected = await rentals.isSignatureRejected(sig)
      expect(isSignatureRejected).to.be.true
    })

    it('should set isSignatureRejected mapping value for all the provided signatures to true', async () => {
      await rentals.rejectSignatures([sig, anotherSig])
      const res = await Promise.all([rentals.isSignatureRejected(sig), rentals.isSignatureRejected(anotherSig)])
      expect(res.every((isRejected) => isRejected)).to.be.true
    })

    it('should revert when no signatures are provided', async () => {
      await expect(rentals.rejectSignatures([])).to.be.revertedWith('Rentals#rejectSignatures: EMPTY_SIGNATURE_ARRAY')
    })

    it('should revert when the signature was already rejected', async () => {
      await rentals.rejectSignatures([sig])
      await expect(rentals.rejectSignatures([sig])).to.be.revertedWith('Rentals#rejectSignature: ALREADY_REJECTED')
    })

    it('should revert when the signature has an invalid length', async () => {
      const invalidSig = ethers.utils.randomBytes(99)
      await expect(rentals.rejectSignatures([invalidSig])).to.be.revertedWith(
        'Rentals#rejectSignature: INVALID_SIGNATURE_LENGTH'
      )
    })
  })
})
