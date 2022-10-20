import { DeployProxyOptions } from '@openzeppelin/hardhat-upgrades/dist/utils'
import { ethers, upgrades } from 'hardhat'
import { DevRentals } from '../typechain-types'

async function main() {
  // Obtain initialization params from env
  const params = {
    owner: process.env.OWNER,
    token: process.env.TOKEN,
    feeCollector: process.env.FEE_COLLECTOR,
    fee: process.env.FEE,
  }

  // Check that none are missing
  for (const [key, value] of Object.entries(params)) {
    if (!value) {
      throw new Error(`Missing argument: ${key}`)
    }
  }

  const [signer] = await ethers.getSigners()

  const initParams: Parameters<DevRentals['initialize']> = [params.owner!, params.token!, params.feeCollector!, params.fee!]
  const deployProxyOpts: DeployProxyOptions = {
    // _disableInitialization is called in the Rentals constructor.
    // The plugin will fail if the contract has a constructor.
    // The constructor is necessary so the warning has to be disabled.
    unsafeAllow: ['constructor'],
    // The type of proxy pattern we are using is the transparent proxy pattern.
    // https://blog.openzeppelin.com/the-transparent-proxy-pattern/
    kind: 'transparent',
  }

  const DevRentals = await ethers.getContractFactory('DevRentals')
  const devRentals = await upgrades.deployProxy(DevRentals, initParams, deployProxyOpts)
  await devRentals.deployed()

  console.log(`DevRentals deployed to: ${devRentals.address} by ${signer.address} using transparent proxy pattern`)
  console.log(`You can check more details in the .openzeppelin folder`)
}

main().catch((err) => {
  console.log(err)
  process.exitCode = 1
})
