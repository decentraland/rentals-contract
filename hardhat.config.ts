import '@typechain/hardhat'
import '@nomiclabs/hardhat-waffle'
import 'solidity-coverage'
import 'hardhat-gas-reporter'

export default {
  solidity: {
    version: '0.8.7',
    settings: {
      optimizer: {
        enabled: true,
      },
    },
  },
}
