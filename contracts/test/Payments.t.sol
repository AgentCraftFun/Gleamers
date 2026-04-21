// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Payments} from "../src/Payments.sol";

contract PaymentsTest is Test {
    Payments internal payments;

    function setUp() public {
        payments = new Payments();
    }

    function test_deploys() public view {
        assert(address(payments) != address(0));
    }
}
