import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { ethers } from 'hardhat'
import {
  DummyNativeMetaTransactionImplementator,
  DummyNativeMetaTransactionImplementator__factory,
  DummyRelayer,
  DummyRelayer__factory,
} from '../typechain-types'
import { getMetaTxFunctionData, getMetaTxSignature } from './utils/nativeMetaTransaction'

describe('NativeMetaTransaction', () => {
  let deployer: SignerWithAddress
  let user: SignerWithAddress
  let NMTImplementatorFactory: DummyNativeMetaTransactionImplementator__factory
  let nmtImplementator: DummyNativeMetaTransactionImplementator
  let RelayerFactory: DummyRelayer__factory
  let relayer: DummyRelayer

  describe('executeMetaTransaction', () => {
    beforeEach(async () => {
      ;[deployer, user] = await ethers.getSigners()

      NMTImplementatorFactory = await ethers.getContractFactory('DummyNativeMetaTransactionImplementator')
      nmtImplementator = await NMTImplementatorFactory.connect(deployer).deploy()

      await nmtImplementator.connect(deployer).initialize()

      RelayerFactory = await ethers.getContractFactory('DummyRelayer')
      relayer = await RelayerFactory.connect(deployer).deploy(nmtImplementator.address)
    })

    it('should increase the contract counter using a meta transaction', async () => {
      const abi = ['function increaseCounter(uint256 _amount)']
      const metaTxFunctionData = getMetaTxFunctionData(abi, 'increaseCounter', [10])
      const metaTxSignature = await getMetaTxSignature(user, nmtImplementator, metaTxFunctionData)

      expect(await nmtImplementator.counter()).to.be.equal(0)

      await nmtImplementator.connect(deployer).executeMetaTransaction(user.address, metaTxFunctionData, metaTxSignature)

      expect(await nmtImplementator.counter()).to.be.equal(10)
    })

    it('should increase the user address nonce after a meta transaction', async () => {
      const abi = ['function increaseCounter(uint256 _amount)']
      const metaTxFunctionData = getMetaTxFunctionData(abi, 'increaseCounter', [10])
      const metaTxSignature = await getMetaTxSignature(user, nmtImplementator, metaTxFunctionData)

      expect(await nmtImplementator.getNonce(user.address)).to.be.equal(0)

      await nmtImplementator.connect(deployer).executeMetaTransaction(user.address, metaTxFunctionData, metaTxSignature)

      expect(await nmtImplementator.getNonce(user.address)).to.be.equal(1)
    })

    it('should return the relayed function transaction response data', async () => {
      const abi = ['function sum(uint256 _a, uint256 _b)']
      const metaTxFunctionData = getMetaTxFunctionData(abi, 'sum', [10, 20])
      const metaTxSignature = await getMetaTxSignature(user, nmtImplementator, metaTxFunctionData)

      let data = await relayer.data()

      expect(data).to.be.equal('0x')

      await relayer.connect(deployer).executeAndStoreMetaTransactionResult(user.address, metaTxFunctionData, metaTxSignature)

      data = await relayer.data()

      expect(data).to.be.equal('0x000000000000000000000000000000000000000000000000000000000000001e')
      expect(ethers.utils.defaultAbiCoder.decode(['uint256'], data)[0]).to.be.equal(30)
    })

    it('should revert with the relayed funcion revert message', async () => {
      const abi = ['function functionThatReverts()']
      const metaTxFunctionData = getMetaTxFunctionData(abi, 'functionThatReverts')
      const metaTxSignature = await getMetaTxSignature(user, nmtImplementator, metaTxFunctionData)

      const functionThatReverts = nmtImplementator.connect(deployer).executeMetaTransaction(user.address, metaTxFunctionData, metaTxSignature)

      await expect(functionThatReverts).to.be.revertedWith('ALWAYS_REVERTING_NEVER_INREVERTING')
    })

    it('should revert wthout a reason if the relayed function reverted silently', async () => {
      const abi = ['function functionThatRevertsSilently()']
      const metaTxFunctionData = getMetaTxFunctionData(abi, 'functionThatRevertsSilently')
      const metaTxSignature = await getMetaTxSignature(user, nmtImplementator, metaTxFunctionData)

      const functionThatReverts = nmtImplementator.connect(deployer).executeMetaTransaction(user.address, metaTxFunctionData, metaTxSignature)

      await expect(functionThatReverts).to.be.revertedWith('Transaction reverted without a reason string')
    })
  })
})
