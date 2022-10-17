// SPDX-License-Identifier: MIT

pragma solidity ^0.8.7;

import "../Rentals.sol";

/// @notice Rentals contract with extra functionality.
/// @dev This contract is used for testing purposes only and should not be used in production.
contract DevRentals is Rentals {
    /// @notice Allows the owner to return assets that are being rented to their respective lessors.
    /// @param _contractAddresses The addresses of the contracts that own the assets.
    /// @param _tokenIds The IDs of the assets to return.
    function returnToLessor(address[] calldata _contractAddresses, uint256[] calldata _tokenIds) external onlyOwner {
        uint256 contractAddressesLength = _contractAddresses.length;

        // Check that the arrays are of the same length.
        require(contractAddressesLength == _tokenIds.length, "ExtendedRentals#returnToLessor: LENGTH_MISMATCH");

        // Iterate over the arrays and return each asset.
        for (uint256 i = 0; i < contractAddressesLength; i++) {
            address contractAddress = _contractAddresses[i];
            uint256 tokenId = _tokenIds[i];

            Rental memory rental = rentals[contractAddress][tokenId];

            address lessor = rental.lessor;

            // Check that the there is a lessor for that asset.
            require(lessor != address(0), "ExtendedRentals#returnToLessor: ASSET_NOT_IN_CONTRACT");

            // Delete the rental to clear up the state for that asset.
            delete rentals[contractAddress][tokenId];

            IERC721Rentable asset = IERC721Rentable(contractAddress);

            // Transfer the asset back to the lessor.
            asset.safeTransferFrom(address(this), lessor, tokenId);
        }
    }
}
