import dotenv from 'dotenv'
import { HardhatUserConfig } from 'hardhat/types'

import '@typechain/hardhat'
import '@nomiclabs/hardhat-waffle'
import 'solidity-coverage'
import 'hardhat-gas-reporter'
import '@openzeppelin/hardhat-upgrades'
import '@nomiclabs/hardhat-etherscan'

dotenv.config()

const privateKey = process.env.PRIVATE_KEY
const rpc = process.env.RPC

const config: HardhatUserConfig = {
  networks: {
    deploy: {
      url: rpc || '',
      accounts: privateKey ? [privateKey] : undefined,
    },
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
  solidity: {
    compilers: [
      {
        version: '0.8.7',
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
      {
        version: '0.4.24',
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
      {
        version: '0.4.18',
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
      {
        version: '0.4.11',
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    ],
  },
}

export default config
