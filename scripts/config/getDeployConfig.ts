import dotenv from 'dotenv'

dotenv.config()

const getDeployConfig = () => ({
  url: process.env.RPC_URL || 'https://rinkeby.infura.io/v3/',
  accounts: [process.env.PRIVATE_KEY || '1234567891111111111111111111111111111111111111111111111111111111'],
})

export default getDeployConfig
