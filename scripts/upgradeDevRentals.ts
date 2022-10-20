import { UpgradeProxyOptions } from '@openzeppelin/hardhat-upgrades/dist/utils'
import { ethers, upgrades } from 'hardhat'

async function main() {
  // Obtain the proxy address from the env.
  const params = {
    // You can find the value for this in the .openzeppelin directory for the network you are using.
    proxyAddress: process.env.PROXY_ADDRESS,
  }

  // Check that none are missing
  for (const [key, value] of Object.entries(params)) {
    if (!value) {
      throw new Error(`Missing argument: ${key}`)
    }
  }

  const [signer] = await ethers.getSigners()

  const upgradeProxyOpts: UpgradeProxyOptions = {
    // _disableInitialization is called in the Rentals constructor.
    // The plugin will fail if the contract has a constructor.
    // The constructor is necessary so the warning has to be disabled.
    unsafeAllow: ['constructor'],
    // The type of proxy pattern we are using is the transparent proxy pattern.
    // https://blog.openzeppelin.com/the-transparent-proxy-pattern/
    kind: 'transparent',
  }

  const DevRentals = await ethers.getContractFactory('DevRentals')
  const devRentals = await upgrades.upgradeProxy(params.proxyAddress!, DevRentals, upgradeProxyOpts)
  await devRentals.deployed()

  console.log(`DevRentals at ${devRentals.address} upgraded by ${signer.address}`)
  console.log(`You can check more details in the .openzeppelin folder`)
}

main().catch((err) => {
  console.log(err)
  process.exitCode = 1
})
