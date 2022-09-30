import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'

// Flatten all main contracts into the full directory
async function main() {
  const fullPath = path.resolve(__dirname, '..', 'full')

  // Define the contracts to flatten and their destinations
  const contracts = [
    ['Rentals.sol', 'Rentals.sol'],
    ['mocks/DevRentals.sol', 'DevRentals.sol'],
  ]

  for (const [origin, target] of contracts) {
    // Run npx hardhat flatten on the current contract
    const output = spawnSync('npx', `hardhat flatten contracts/${origin}`.split(' '), { cwd: path.resolve(__dirname, '..') })
    const outputPath = path.resolve(fullPath, target)

    // Write the flattened file in the full directory
    fs.writeFileSync(outputPath, output.stdout)
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
