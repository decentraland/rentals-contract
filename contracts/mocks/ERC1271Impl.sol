// SPDX-License-Identifier: MIT

pragma solidity 0.8.7;

import "@openzeppelin/contracts-upgradeable/utils/cryptography/ECDSAUpgradeable.sol";
import "@openzeppelin/contracts/interfaces/IERC721.sol";
import "@openzeppelin/contracts/interfaces/IERC20.sol";

import "../Rentals.sol";

/// @dev Mock contract for testing ERC1271 signature verification in the Rentals contract.
contract ERC1271Impl {
    address private immutable owner;

    constructor(address _owner) {
        owner = _owner;
    }

    function isValidSignature(bytes32 _hash, bytes memory _signature) external view returns (bytes4 magicValue) {
        (address signer, ) = ECDSAUpgradeable.tryRecover(_hash, _signature);

        if (owner == signer) {
            return 0x1626ba7e;
        } else {
            return 0;
        }
    }

    function erc721_setApprovalForAll(address _contractAddress, address _operator, bool _approved) external {
        IERC721(_contractAddress).setApprovalForAll(_operator, _approved);
    }

    function erc20_approve(address _contractAddress, address _spender, uint256 _amount) external {
        IERC20(_contractAddress).approve(_spender, _amount);
    }

    function rentals_setUpdateOperator(
        address _rentals,
        address[] calldata _contractAddresses,
        uint256[] calldata _tokenIds,
        address[] calldata _operators
    ) external {
        Rentals(_rentals).setUpdateOperator(_contractAddresses, _tokenIds, _operators);
    }

    function rentals_claim(address _rentals, address[] calldata _contractAddresses, uint256[] calldata _tokenIds) external {
        Rentals(_rentals).claim(_contractAddresses, _tokenIds);
    }

    function onERC721Received(
        address, // _operator,
        address, // _from,
        uint256, // _tokenId,
        bytes calldata // _data
    ) external pure returns (bytes4) {
        // This function is required or else Rentals.claim will fail when doing the safeTransferFrom.
        return bytes4(keccak256("onERC721Received(address,address,uint256,bytes)"));
    }
}
