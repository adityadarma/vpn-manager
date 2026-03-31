import { execSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import type { VpnDriver } from '../drivers'
import { loadAgentEnv } from '../config/env'

interface GenerateClientCertParams {
  username: string
  password?: string // Optional password for encrypting private key
  validDays?: number // Certificate validity in days (default: 365)
}

interface GenerateClientCertResult {
  clientCert: string
  clientKey: string
  passwordProtected: boolean
  expiresAt: string
}

export async function handleGenerateClientCert(params: Record<string, unknown>, _driver: VpnDriver): Promise<Record<string, unknown>> {
  const username = params.username as string | undefined
  const password = params.password as string | undefined
  const validDays = params.validDays as number | null | undefined

  if (!username || typeof username !== 'string') {
    throw new Error('Username is required')
  }

  const env = loadAgentEnv()

  // WIRE GUARD KEY GENERATION
  if (env.VPN_TYPE === 'wireguard') {
    console.log(`[generate-cert] Generating WireGuard Keypair for ${username}...`)
    try {
      // Generate private key
      const privateKey = execSync('wg genkey', { encoding: 'utf-8' }).trim()
      // Generate matching public key
      const publicKey = execSync('wg pubkey', { input: privateKey + '\n', encoding: 'utf-8' }).trim()

      return {
        clientCert: publicKey, // For WG, 'cert' stores the Public Key
        clientKey: privateKey, // For WG, 'key' stores the Private Key
        passwordProtected: false, // WG keys typically aren't passphrase protected on generation here
        expiresAt: null // WG keys generally don't expire natively like X509
      }
    } catch (err: any) {
      console.error(`[generate-cert] Failed to generate WireGuard keys for ${username}:`, err.message)
      throw new Error(`WireGuard key generation failed: ${err.message}`)
    }
  }

  // OPENVPN CERTIFICATE GENERATION (Existing Logic)
  // If validDays is null or 0, set to 36500 days (100 years ~ unlimited)
  const certValidDays = (validDays === null || validDays === 0) ? 36500 : (validDays ?? 3650)

  const EASYRSA_DIR = '/etc/openvpn/easy-rsa'
  const EASYRSA_BIN = `${EASYRSA_DIR}/easyrsa`
  
  if (!existsSync(EASYRSA_DIR)) {
    throw new Error('EasyRSA directory not found. Please install VPN server first.')
  }

  if (!existsSync(EASYRSA_BIN)) {
    throw new Error(`EasyRSA script not found at ${EASYRSA_BIN}. Please check VPN installation.`)
  }

  console.log(`[generate-cert] Generating certificate for ${username} (valid for ${certValidDays === 36500 ? 'unlimited' : certValidDays + ' days'})...`)

  try {
    // EasyRSA 3.x paths
    const certPath = `${EASYRSA_DIR}/pki/issued/${username}.crt`
    const keyPath = `${EASYRSA_DIR}/pki/private/${username}.key`
    const reqPath = `${EASYRSA_DIR}/pki/reqs/${username}.req`
    
    // Check if any certificate files exist
    const filesExist = existsSync(certPath) || existsSync(keyPath) || existsSync(reqPath)
    
    if (filesExist) {
      console.log(`[generate-cert] Certificate files for ${username} already exist, performing cleanup...`)
      
      // Step 1: Try to revoke if certificate exists
      if (existsSync(certPath)) {
        try {
          execSync(`${EASYRSA_BIN} revoke ${username}`, {
            cwd: EASYRSA_DIR,
            env: { ...process.env, EASYRSA_BATCH: '1' },
            stdio: 'pipe'
          })
          console.log(`[generate-cert] ✓ Certificate revoked in PKI`)
          
          // Generate updated CRL after revocation
          try {
            execSync(`${EASYRSA_BIN} gen-crl`, {
              cwd: EASYRSA_DIR,
              env: { ...process.env, EASYRSA_BATCH: '1' },
              stdio: 'pipe'
            })
            console.log(`[generate-cert] ✓ CRL updated`)
          } catch (crlErr) {
            console.warn(`[generate-cert] Warning: Could not update CRL`)
          }
        } catch (err) {
          console.warn(`[generate-cert] Warning: Could not revoke certificate (might not be in CRL yet)`)
        }
      }
      
      // Step 2: Remove from PKI index database
      const indexPath = `${EASYRSA_DIR}/pki/index.txt`
      
      if (existsSync(indexPath)) {
        try {
          // Create backup
          execSync(`cp "${indexPath}" "${indexPath}.bak-$(date +%s)"`, { stdio: 'pipe' })
          
          // Remove all lines containing this username (both valid and revoked)
          execSync(`sed -i '/CN=${username}$/d' "${indexPath}"`, { stdio: 'pipe' })
          console.log(`[generate-cert] ✓ Removed from PKI index`)
        } catch (err) {
          console.warn(`[generate-cert] Warning: Could not update PKI index`)
        }
      }
      
      // Step 3: Force remove ALL certificate-related files
      try {
        const filesToRemove = [
          certPath,
          keyPath,
          reqPath,
          `${EASYRSA_DIR}/pki/issued/${username}.*`,
          `${EASYRSA_DIR}/pki/private/${username}.*`,
          `${EASYRSA_DIR}/pki/inline/private/${username}.*`,
          `${EASYRSA_DIR}/pki/reqs/${username}.*`,
          `${EASYRSA_DIR}/pki/renewed/certs_by_serial/${username}.*`,
          `${EASYRSA_DIR}/pki/renewed/private_by_serial/${username}.*`,
          `${EASYRSA_DIR}/pki/renewed/reqs_by_serial/${username}.*`
        ]
        
        for (const pattern of filesToRemove) {
          try {
            execSync(`rm -f ${pattern}`, { stdio: 'pipe' })
          } catch (e) {
            // Ignore errors for non-existent files
          }
        }
        
        console.log(`[generate-cert] ✓ All certificate files removed`)
      } catch (err) {
        console.warn(`[generate-cert] Warning: Could not remove some certificate files`)
      }
      
      // Step 4: Clean up serial files if they reference this cert
      try {
        // Find and remove serial files that might reference this certificate
        const serialFiles = execSync(
          `grep -l "CN=${username}" ${EASYRSA_DIR}/pki/issued/*.crt 2>/dev/null | xargs -r basename -s .crt 2>/dev/null || true`,
          { encoding: 'utf-8', stdio: 'pipe' }
        ).trim()
        
        if (serialFiles) {
          serialFiles.split('\n').forEach(serial => {
            if (serial) {
              try {
                execSync(`rm -f "${EASYRSA_DIR}/pki/renewed/certs_by_serial/${serial}.crt"`, { stdio: 'pipe' })
                execSync(`rm -f "${EASYRSA_DIR}/pki/renewed/private_by_serial/${serial}.key"`, { stdio: 'pipe' })
                execSync(`rm -f "${EASYRSA_DIR}/pki/renewed/reqs_by_serial/${serial}.req"`, { stdio: 'pipe' })
              } catch (e) {
                // Ignore
              }
            }
          })
        }
      } catch (err) {
        // Ignore errors in serial cleanup
      }
      
      console.log(`[generate-cert] ✓ Cleanup completed for ${username}`)
    }

    // Generate client certificate with EasyRSA 3.x
    if (password) {
      // Generate with password-protected key
      execSync(`${EASYRSA_BIN} build-client-full ${username}`, {
        cwd: EASYRSA_DIR,
        env: { 
          ...process.env, 
          EASYRSA_BATCH: '1',
          EASYRSA_CERT_EXPIRE: certValidDays.toString(),
          EASYRSA_PASSOUT: `pass:${password}`
        },
        stdio: 'pipe'
      })
    } else {
      // Generate without password (nopass)
      execSync(`${EASYRSA_BIN} build-client-full ${username} nopass`, {
        cwd: EASYRSA_DIR,
        env: { 
          ...process.env, 
          EASYRSA_BATCH: '1',
          EASYRSA_CERT_EXPIRE: certValidDays.toString()
        },
        stdio: 'pipe'
      })
    }

    // Read generated certificate and key
    const clientCert = readFileSync(certPath, 'utf-8')
    const clientKey = readFileSync(keyPath, 'utf-8')

    // Calculate expiration date (null if unlimited)
    const expiresAt = certValidDays === 36500 ? null : (() => {
      const date = new Date()
      date.setDate(date.getDate() + certValidDays)
      return date.toISOString()
    })()

    console.log(`[generate-cert] ✓ Client certificate generated for ${username}`)

    return {
      clientCert,
      clientKey,
      passwordProtected: !!password,
      expiresAt: expiresAt
    }
  } catch (error: any) {
    console.error(`[generate-cert] Failed to generate client certificate for ${username}:`, error.message)
    
    // Provide more detailed error message
    let errorMsg = error.message
    if (error.stderr) {
      errorMsg += `\nStderr: ${error.stderr.toString()}`
    }
    if (error.stdout) {
      errorMsg += `\nStdout: ${error.stdout.toString()}`
    }
    
    throw new Error(`Failed to generate client certificate: ${errorMsg}`)
  }
}
