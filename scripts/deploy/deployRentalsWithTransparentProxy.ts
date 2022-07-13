import { ethers, upgrades } from 'hardhat'

const configByNetwork = new Map([
  [
    'GOERLI',
    {
      owner: '0xb919da06d5f81777B13Fc5CBd48635E19500Fbf5',
      token: '0xe7fDae84ACaba2A5Ba817B6E6D8A2d415DBFEdbe',
      feeCollector: '0xb919da06d5f81777B13Fc5CBd48635E19500Fbf5',
      fee: '10000',
    },
  ],
])

async function main() {
  const network = process.env.NETWORK

  if (!network) {
    throw new Error('NETWORK not found')
  }

  const config = configByNetwork.get(network)

  if (!config) {
    throw new Error('Config for network not defined')
  }

  const Rentals = await ethers.getContractFactory('Rentals')
  const instance = await upgrades.deployProxy(Rentals, [config.owner, config.token, config.feeCollector, config.fee])
  await instance.deployed()

  const [signer] = await ethers.getSigners()

  console.log(`Rentals contract deployed at ${instance.address} by ${signer.address}`)
}

main()
