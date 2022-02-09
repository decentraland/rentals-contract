import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { Rentals } from "../typechain-types/Rentals";

describe("Rentals", () => {
  let deployer: SignerWithAddress;
  let owner: SignerWithAddress;
  let rentals: Rentals;

  beforeEach(async () => {
    // Store addresses
    [deployer, owner] = await ethers.getSigners();

    // Deploy Rentals contract
    const RentalsFactory = await ethers.getContractFactory("Rentals");
    rentals = await RentalsFactory.connect(deployer).deploy();
  });

  describe("initialize", () => {
    it("should set the owner", async () => {
      await rentals.connect(deployer).initialize(owner.address);
      const rentalsOwner = await rentals.owner();
      expect(rentalsOwner).to.be.equal(owner.address);
    });

    it("should revert when initialized more than once", async () => {
      await rentals.connect(deployer).initialize(owner.address);
      await expect(
        rentals.connect(deployer).initialize(owner.address)
      ).to.be.revertedWith("Initializable: contract is already initialized");
    });
  });
});
