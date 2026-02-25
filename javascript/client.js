'use strict';

/**
 * Frontend Client Example
 * This file shows how to interact with the FabCar backend server
 * Can be used in a web application, mobile app, or Node.js client
 */

const http = require('http');

// Configuration - allow overriding via environment variable for local testing
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:4000/api';

// Helper function to make HTTP requests
function makeRequest(method, endpoint, data = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(API_BASE_URL + endpoint);

        const options = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method: method,
            headers: {
                'Content-Type': 'application/json'
            }
        };

        const req = http.request(options, (res) => {
            let responseData = '';

            res.on('data', (chunk) => {
                responseData += chunk;
            });

            res.on('end', () => {
                try {
                    const parsed = JSON.parse(responseData);
                    resolve(parsed);
                } catch (e) {
                    resolve(responseData);
                }
            });
        });

        req.on('error', (error) => {
            reject(error);
        });

        if (data) {
            req.write(JSON.stringify(data));
        }

        req.end();
    });
}

// ============ Client API Wrapper Functions ============

class FabCarClient {
    constructor(userId) {
        this.userId = userId;
    }

    /**
     * Check server health
     */
    async checkHealth() {
        try {
            const response = await makeRequest('GET', '/health');
            console.log('✓ Server health:', response);
            return response;
        } catch (error) {
            console.error('✗ Health check failed:', error);
            throw error;
        }
    }

    /**
     * Register a new participant
     */
    async register(name, password, country) {
        try {
            const response = await makeRequest('POST', '/register', {
                userId: this.userId,
                name,
                password,
                country
            });
            console.log('✓ Registration successful:', response);
            return response;
        } catch (error) {
            console.error('✗ Registration failed:', error);
            throw error;
        }
    }

    /**
     * Check if participant exists
     */
    async participantExists(networkAddress) {
        try {
            const response = await makeRequest('GET', `/participant/${networkAddress}?userId=${this.userId}`);
            console.log('✓ Participant check:', response);
            return response;
        } catch (error) {
            console.error('✗ Participant check failed:', error);
            throw error;
        }
    }

    /**
     * Request a token
     */
    async requestToken(name, networkAddress, country) {
        try {
            const response = await makeRequest('POST', '/token-request', {
                userId: this.userId,
                name,
                networkAddress,
                country
            });
            console.log('✓ Token request submitted:', response);
            return response;
        } catch (error) {
            console.error('✗ Token request failed:', error);
            throw error;
        }
    }

    /**
     * Get pending token requests (admin)
     */
    async getPendingTokenRequests(adminId) {
        try {
            const response = await makeRequest('GET', `/token-requests/pending?adminId=${adminId}`);
            console.log('✓ Pending token requests:', response);
            return response;
        } catch (error) {
            console.error('✗ Failed to get pending token requests:', error);
            throw error;
        }
    }

    /**
     * Approve token request (admin)
     */
    async approveTokenRequest(requestId, adminId) {
        try {
            const response = await makeRequest('POST', `/token-requests/${requestId}/approve`, {
                adminId
            });
            console.log('✓ Token request approved:', response);
            return response;
        } catch (error) {
            console.error('✗ Token approval failed:', error);
            throw error;
        }
    }

    /**
     * Get token access
     */
    async getTokenAccess(networkAddress) {
        try {
            const response = await makeRequest('POST', '/token-access', {
                userId: this.userId,
                networkAddress
            });
            console.log('✓ Token access:', response);
            return response;
        } catch (error) {
            console.error('✗ Failed to get token access:', error);
            throw error;
        }
    }

    /**
     * Request to mint coins
     */
    async requestMint(networkAddress, amount, purpose = 'WORKING_CAPITAL') {
        try {
            const response = await makeRequest('POST', '/mint-request', {
                userId: this.userId,
                networkAddress,
                amount,
                purpose
            });
            console.log('✓ Mint request submitted:', response);
            return response;
        } catch (error) {
            console.error('✗ Mint request failed:', error);
            throw error;
        }
    }

    /**
     * Get pending mint requests (admin)
     */
    async getPendingMintRequests(adminId) {
        try {
            const response = await makeRequest('GET', `/mint-requests/pending?adminId=${adminId}`);
            console.log('✓ Pending mint requests:', response);
            return response;
        } catch (error) {
            console.error('✗ Failed to get pending mint requests:', error);
            throw error;
        }
    }

    /**
     * Approve mint request (admin)
     */
    async approveMintRequest(requestId, adminId) {
        try {
            const response = await makeRequest('POST', `/mint-requests/${requestId}/approve`, {
                adminId
            });
            console.log('✓ Mint request approved:', response);
            return response;
        } catch (error) {
            console.error('✗ Mint approval failed:', error);
            throw error;
        }
    }

    /**
     * Get wallet information
     */
    async getWalletInfo(networkAddress) {
        try {
            const response = await makeRequest('GET', `/wallet/${networkAddress}?userId=${this.userId}`);
            console.log('✓ Wallet info:', response);
            return response;
        } catch (error) {
            console.error('✗ Failed to get wallet info:', error);
            throw error;
        }
    }

    /**
     * View all tokens
     */
    async viewAllTokens() {
        try {
            const response = await makeRequest('GET', `/tokens?userId=${this.userId}`);
            console.log('✓ All tokens:', response);
            return response;
        } catch (error) {
            console.error('✗ Failed to view tokens:', error);
            throw error;
        }
    }

    /**
     * Register customer
     */
    async registerCustomer(networkAddress, name, tokenID) {
        try {
            const response = await makeRequest('POST', '/customer-register', {
                userId: this.userId,
                networkAddress,
                name,
                tokenID
            });
            console.log('✓ Customer registered:', response);
            return response;
        } catch (error) {
            console.error('✗ Customer registration failed:', error);
            throw error;
        }
    }

    /**
     * Get pending customer registrations
     */
    async getPendingCustomerRegistrations(tokenID, ownerNetworkAddress) {
        try {
            const response = await makeRequest('GET', `/customer-registrations/pending?userId=${this.userId}&tokenID=${tokenID}&ownerNetworkAddress=${ownerNetworkAddress}`);
            console.log('✓ Pending customer registrations:', response);
            return response;
        } catch (error) {
            console.error('✗ Failed to get pending registrations:', error);
            throw error;
        }
    }

    /**
     * Approve customer registration
     */
    async approveCustomerRegistration(requestId, ownerNetworkAddress) {
        try {
            const response = await makeRequest('POST', `/customer-registrations/${requestId}/approve`, {
                userId: this.userId,
                ownerNetworkAddress
            });
            console.log('✓ Customer registration approved:', response);
            return response;
        } catch (error) {
            console.error('✗ Customer approval failed:', error);
            throw error;
        }
    }

    /**
     * Request customer mint
     */
    async customerRequestMint(networkAddress, tokenID, amount) {
        try {
            const response = await makeRequest('POST', '/customer-mint-request', {
                userId: this.userId,
                networkAddress,
                tokenID,
                amount
            });
            console.log('✓ Customer mint requested:', response);
            return response;
        } catch (error) {
            console.error('✗ Customer mint request failed:', error);
            throw error;
        }
    }

    /**
     * Get pending customer mint requests
     */
    async getPendingCustomerMintRequests(tokenID, ownerNetworkAddress) {
        try {
            const response = await makeRequest('GET', `/customer-mint-requests/pending?userId=${this.userId}&tokenID=${tokenID}&ownerNetworkAddress=${ownerNetworkAddress}`);
            console.log('✓ Pending customer mint requests:', response);
            return response;
        } catch (error) {
            console.error('✗ Failed to get pending mint requests:', error);
            throw error;
        }
    }

    /**
     * Approve customer mint
     */
    async approveCustomerMint(requestId, ownerNetworkAddress) {
        try {
            const response = await makeRequest('POST', `/customer-mint-requests/${requestId}/approve`, {
                userId: this.userId,
                ownerNetworkAddress
            });
            console.log('✓ Customer mint approved:', response);
            return response;
        } catch (error) {
            console.error('✗ Customer mint approval failed:', error);
            throw error;
        }
    }

    /**
     * Get customer wallet
     */
    async getCustomerWallet(networkAddress, tokenID) {
        try {
            const response = await makeRequest('GET', `/customer-wallet/${networkAddress}?userId=${this.userId}&tokenID=${tokenID}`);
            console.log('✓ Customer wallet:', response);
            return response;
        } catch (error) {
            console.error('✗ Failed to get customer wallet:', error);
            throw error;
        }
    }

    /**
     * Create transfer request
     */
    async createTransferRequest(senderParticipantID, senderTokenTransferID, receiverTokenTransferID, tokenID, amount) {
        try {
            const response = await makeRequest('POST', '/transfer-request', {
                userId: this.userId,
                senderParticipantID,
                senderTokenTransferID,
                receiverTokenTransferID,
                tokenID,
                amount
            });
            console.log('✓ Transfer request created:', response);
            return response;
        } catch (error) {
            console.error('✗ Transfer request creation failed:', error);
            throw error;
        }
    }

    /**
     * Approve transfer by owner
     */
    async approveTransferByOwner(transferRequestID, approver) {
        try {
            const response = await makeRequest('POST', `/transfer-requests/${transferRequestID}/approve-owner`, {
                userId: this.userId,
                approver
            });
            console.log('✓ Transfer approved by owner:', response);
            return response;
        } catch (error) {
            console.error('✗ Transfer approval by owner failed:', error);
            throw error;
        }
    }

    /**
     * Approve transfer by receiver
     */
    async approveTransferByReceiver(transferRequestID, approver) {
        try {
            const response = await makeRequest('POST', `/transfer-requests/${transferRequestID}/approve-receiver`, {
                userId: this.userId,
                approver
            });
            console.log('✓ Transfer approved by receiver:', response);
            return response;
        } catch (error) {
            console.error('✗ Transfer approval by receiver failed:', error);
            throw error;
        }
    }

    /**
     * Get transfer requests for owner
     */
    async getTransferRequestsForOwner(ownerID) {
        try {
            const response = await makeRequest('GET', `/transfer-requests/owner/${ownerID}?userId=${this.userId}`);
            console.log('✓ Transfer requests for owner:', response);
            return response;
        } catch (error) {
            console.error('✗ Failed to get transfer requests:', error);
            throw error;
        }
    }

    /**
     * Get transfer requests for receiver
     */
    async getTransferRequestsForReceiver() {
        try {
            const response = await makeRequest('GET', '/transfer-requests/receiver');
            console.log('✓ Transfer requests for receiver:', response);
            return response;
        } catch (error) {
            console.error('✗ Failed to get transfer requests:', error);
            throw error;
        }
    }

    /**
     * Get participant transfer history
     */
    async getParticipantTransferHistory(participantTransferID) {
        try {
            const response = await makeRequest('GET', `/transfer-history/participant/${participantTransferID}?userId=${this.userId}`);
            console.log('✓ Participant transfer history:', response);
            return response;
        } catch (error) {
            console.error('✗ Failed to get transfer history:', error);
            throw error;
        }
    }

    /**
     * Get token transfer history
     */
    async getTokenTransferHistory(tokenID) {
        try {
            const response = await makeRequest('GET', `/transfer-history/token/${tokenID}?userId=${this.userId}`);
            console.log('✓ Token transfer history:', response);
            return response;
        } catch (error) {
            console.error('✗ Failed to get token history:', error);
            throw error;
        }
    }

    /**
     * Get token participants and transactions
     */
    async getTokenParticipantsAndTransactions(tokenID, callerTransferID) {
        try {
            const response = await makeRequest('GET', `/token-participants/${tokenID}?userId=${this.userId}&callerTransferID=${callerTransferID}`);
            console.log('✓ Token participants:', response);
            return response;
        } catch (error) {
            console.error('✗ Failed to get token participants:', error);
            throw error;
        }
    }

    /**
     * Get participant transfer history by owner
     */
    async getParticipantTransferHistoryByOwner(participantTransferID) {
        try {
            const response = await makeRequest('GET', `/transfer-history/owner/${participantTransferID}?userId=${this.userId}`);
            console.log('✓ Participant transfer history by owner:', response);
            return response;
        } catch (error) {
            console.error('✗ Failed to get transfer history:', error);
            throw error;
        }
    }
}

// ============ Example Usage ============

async function runExample() {
    console.log('=== FabCar Client Example ===\n');

    // Create a client instance
    const client = new FabCarClient('user1');

    try {
        // Check server health
        await client.checkHealth();
        console.log('\n');

        // Register a participant
        const registerResult = await client.register('John Doe', 'password123', 'USA');
        console.log('\n');

        // Check if participant exists
        // const existsResult = await client.participantExists('networkAddr123');
        // console.log('\n');

        // View all tokens
        const tokensResult = await client.viewAllTokens();
        console.log('\n');

    } catch (error) {
        console.error('Error:', error.message);
    }
}

// Export client class for use in other modules
module.exports = FabCarClient;

// Run example if this file is executed directly
if (require.main === module) {
    runExample();
}
