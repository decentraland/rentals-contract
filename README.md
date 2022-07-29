# Rentals Contract

This contract provides an on-chain renting capabilities for Decentraland's LAND and Estates.

By capitalizing on off-chain signatures, users only need to spend gas on critical transactions and avoid operations that can be done safely off-chain like handling listings or bids.

This contract is intended for Decentraland's LAND and Estates but can be used with any ERC721 that has a `setUpdateOperator` function to give operator permissions to an address.

There are various ways to initialize a rent. What all of them have in common is that a user has to send a transaction to initialize the rent using a signature created off-chain by another user as verification of the rental conditions.

For example, if I wanted to become the tenant of a LAND, I would have to call the `acceptListing` with the listing conditions and a signature created by the owner of said LAND to verify that both users are in agreement of the rental.

## Listing

If I wanted to rent my LAND in order to accrue an extra income from it, I could do it with the following steps:

1 - Authorize the Rentals contract to operate LAND

You can do so by calling `approve` with the address of the Rentals contract and the token id of the LAND you want to rent.

You can also do it with `setApprovalForAll` with the address of the Rentals contract.

The difference between one and the other is that you will need to call `approve` for each individual LAND you want to rent, while with `setApprovalForAll` you only have to do it once and never again.

2 - Sign the rental conditions

There are various conditions that you can set for a rental to occur. You can have a glimpse of what these conditions are by looking at the Listing struct.

<a id="listing-struct"></a>
```
struct Listing {
    address signer;
    address contractAddress;
    uint256 tokenId;
    uint256 expiration;
    uint256[3] nonces;
    uint256[] pricePerDay;
    uint256[] maxDays;
    uint256[] minDays;
    address target;
    bytes signature;
}
```

- signer: The address of the signer, in this case, my address.
- contractAddress: The address of the LAND contract.
- tokenId: The token id of the LAND I want to rent.
- expiration: The timestamp from which the signature will not be valid anymore.
- nonces: The three of them have to match the current nonces in the Rentals contract to be valid. Find more about it in the [Nonces](#nonces) section.
- pricePerDay: Defines the price per day for the min and max days range in the same index.
- maxDays: max amount of days the LAND can be rented for a given index.
- minDays: min amount of days the LAND can be rented for a given index.
- target: If defined, only the target address can use the signature, if not, anyone can do.

There are various ways of signing these conditions. One of them can be achieved by using ethers as seen in the [./test/utlils/rentals.ts](https://github.com/decentraland/rentals-contract/blob/main/test/utils/rentals.ts#L26) utility file.

Once both the signature and the listings conditions are ready, I or whichever off-chain system will be handling this, can store them to make them 
available for interested users that want to rent my LAND.

The interested user can interact with the Rentals contract via `acceptListing` with this data to initialize the rent. You can see more about [Accept Listing](#accept-listing) in its corresponding section.

## Accept Listing

In the case that I am interested in renting a LAND I have to do the following:

1 - Authorize the Rentals contract to transfer my MANA

Rentals are paid upfront once they are initialized. For this, the Rentals contract needs authorization to move my MANA to the owner of the LAND I'm renting and a small cut to the DAO.

To do this, I can simply call the `approve` function in the MANA contract with the address of the Rentals contract as the spender and a value of MANA greater or equal to the price I have to pay for the rental. I could set an incredibly large number as the value so with just 1 authorization, I can forget about doing it again in the future and just go to step 2 directly.

2 - Obtain a listing and its corresponding signature

In order to accept a listing, I would need to get the listing conditions as well as a signature created by the onwer of the LAND I want to rent. The way I do this depends on the off-chain system the owner has used to store this information. But once I obtain them, I'm good to call the `acceptListing` function and start the rental.

2 - Call `acceptListing` in the Rentals contract

Once the previous information is at hand, I can finally call the function to accept the listing.

```
function acceptListing(
    Listing calldata _listing,
    address _operator,
    uint256 _index,
    uint256 _rentalDays,
    bytes32 _fingerprint
) external
```

- listing: [Listing](#listing-struct) data containing both the conditions and the signature of owner of the LAND.
- operator: The address that will be given operator permitions via the `setUpdateOperator` in the LAND contract. In other words, the user that I want being able to deploy scenes in that LAND, it could be myself if I wanted to but maybe I want someone else to do it.
- index: Remember that the Listing contains arrays for pricePerDay, maxDays and minDays? This value determines which index of those arrays I want to choose for this rental.
- rentalDays: The amount of days I want to rent this LAND. It has to be in range between the min and max days of the index I choose or else it fails.

If everything is correct, MANA equivalent to the pricePerDay index I've selected, times the rentalDays I provided will be transfered from my address to the lessor (and a fee to the DAO) and the provided operator will start being able to deploy scenes to that LAND.

## Nonces

The Rentals contract contains various nonces of different types used to verify if a signature is valid. They can be modified used to [Invalidate Signatures](#invalidating-signatures) in many levels.

- contractNonce: A nonce that once its changed by the owner of the contract, will make all signatures signed with the previous value invalid.
- signerNonce: A nonce that once its changed by sender of the transaction, will make all signatures signed by the sender invalid.
- assetNonce: A nonce that once its changed by sender of the transaction, will make all signatures signed by the sender for a given asset invalid.

The `uint256[3] nonces;` field in the [Listing](#listing-struct) struct, in order to be valid. must be conformed by the current [contactNonce, signerNonce, assetNonce].

For example, if I wanted to sign a listing, I would need to ask the Rentals contract for these values via the public variables exposed:

```
uint256 public contractNonce;
mapping(address => uint256) public signerNonce;
mapping(address => mapping(uint256 => mapping(address => uint256))) public assetNonce;
```

In pseudo js code, if I wanted to rent a LAND, I would need to obtain the nonces doing something like this:

```
const contractNonce = await rentalsContract.contractNonce();
const signerNonce = await rentalsContract.signerNonce(myAddress);
const assetNonce = await rentalsContract.contractNonce(landContractAddress, landTokenId, myAddress);

const listing = {
  ...otherParams,
  nonces: [contractNonce, signerNonce, assetNonce]
}
```

## Invalidating Signatures

## Running Tests

Install dependencies with `npm ci`

Run tests with `npx hardhat test`
