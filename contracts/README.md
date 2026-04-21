# contracts

Foundry project for Gleamers' `Payments` contract.

- **Chain:** Base mainnet (8453) and Base Sepolia (84532) for testing
- **Compiler:** Solidity 0.8.24
- **Admin:** OpenZeppelin `Ownable` (single admin, set in constructor)
- **Splits:**
  - Super chat → 90% streamer owner, 10% treasury
  - Deploy fee → 20% burned (dead address), 80% treasury
- **Custody:** The contract never holds user funds. Payers must
  ERC20-approve the contract; each action performs two `transferFrom`
  calls in one transaction.

## Install Foundry

```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

## Install dependencies

```bash
cd contracts
forge install foundry-rs/forge-std --shallow
forge install OpenZeppelin/openzeppelin-contracts@v5.0.2 --shallow
```

Both are already configured in `remappings.txt`.

## Build

```bash
forge build
```

## Test

```bash
forge test           # run the suite
forge test -vv       # show console logs
forge coverage --no-match-coverage "(test|script)/"
```

Current suite: **33 tests, 100% line / statement / branch / function
coverage** of `src/Payments.sol`.

## Deploy

Set env for the target network:

```bash
export TOKEN_ADDRESS=0x…       # ERC-20 utility token
export TREASURY_WALLET=0x…     # recipient wallet
export ADMIN_WALLET=0x…        # Ownable admin
# optional: export DEAD_ADDRESS=0x…dEaD
export DEPLOYER_PK=0x…         # deployer key (fund on target chain)
export BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
export BASESCAN_KEY=…
```

Deploy to Base Sepolia first:

```bash
forge script script/Deploy.s.sol:DeployPayments \
  --rpc-url base_sepolia \
  --private-key $DEPLOYER_PK \
  --broadcast --verify
```

Once you've validated end-to-end on testnet, deploy to Base:

```bash
forge script script/Deploy.s.sol:DeployPayments \
  --rpc-url base \
  --private-key $DEPLOYER_PK \
  --broadcast --verify
```

## Post-deploy checklist

Admin must configure prices before the contract is useful. The contract
ships with every tier amount and the deploy fee at `0`, which blocks
all user-facing actions until set.

From the admin wallet:

1. `setTierAmount(1, <amount>)` — Tier 1 super chat price
2. `setTierAmount(2, <amount>)` — Tier 2 super chat price
3. `setTierAmount(3, <amount>)` — Tier 3 super chat price
4. `setDeployFee(<amount>)` — fee to deploy a streamer
5. Verify `paused == false`
6. Optionally `transferOwnership` to a multisig

Record the deployed address in:

- `.env` → `PAYMENTS_ADDRESS` (for worker + orchestrator)
- `web/.env.local` → `NEXT_PUBLIC_PAYMENTS_ADDRESS`

Leave `NEXT_PUBLIC_TOKEN_LIVE=false` until tier amounts and deploy fee
are set on mainnet.

## Admin operations

| Function                 | Purpose                                      |
|--------------------------|----------------------------------------------|
| `setTreasury`            | Rotate treasury wallet                       |
| `setDeadAddress`         | Rotate burn sink                             |
| `setPaused(true/false)`  | Kill-switch for both user entry points       |
| `setTierAmount(tier, x)` | Adjust super chat price (set 0 to disable)   |
| `setDeployFee(x)`        | Adjust deploy fee (set 0 to disable deploys) |
| `emergencyWithdraw`      | Rescue tokens accidentally sent here         |

## Do NOT deploy yet

Integration on the backend/frontend is ongoing. This README covers the
operational steps for when launch is ready. For now, run `forge test`
to verify behavior.
