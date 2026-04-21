// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Payments} from "../src/Payments.sol";

/// @notice Deploy the Payments contract. Reads config from env:
///   TOKEN_ADDRESS   — ERC-20 utility token on the target chain
///   TREASURY_WALLET — treasury recipient (80% of deploy fees, 10% of super chats)
///   DEAD_ADDRESS    — burn sink (default 0x…dEaD). Optional.
///   ADMIN_WALLET    — Ownable admin (can pause, set tiers, set fee)
///
/// Run:
///   forge script script/Deploy.s.sol:DeployPayments \
///     --rpc-url base_sepolia --private-key $DEPLOYER_PK --broadcast --verify
contract DeployPayments is Script {
    address internal constant DEFAULT_DEAD =
        0x000000000000000000000000000000000000dEaD;

    function run() external returns (Payments payments) {
        address tokenAddr = vm.envAddress("TOKEN_ADDRESS");
        address treasury = vm.envAddress("TREASURY_WALLET");
        address admin = vm.envAddress("ADMIN_WALLET");
        address dead = vm.envOr("DEAD_ADDRESS", DEFAULT_DEAD);

        require(tokenAddr != address(0), "TOKEN_ADDRESS unset");
        require(treasury != address(0), "TREASURY_WALLET unset");
        require(admin != address(0), "ADMIN_WALLET unset");

        console2.log("token:   ", tokenAddr);
        console2.log("treasury:", treasury);
        console2.log("dead:    ", dead);
        console2.log("admin:   ", admin);

        vm.startBroadcast();
        payments = new Payments(IERC20(tokenAddr), treasury, dead, admin);
        vm.stopBroadcast();

        console2.log("Payments deployed at:", address(payments));
        console2.log(
            "Next: admin must call setTierAmount(1..3, ...) and setDeployFee(...)"
        );
    }
}
