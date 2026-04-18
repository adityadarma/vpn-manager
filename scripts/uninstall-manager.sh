#!/bin/bash
# ============================================================
# VPN Manager - Production Uninstallation Script
# ============================================================
# This script removes VPN Manager installation
#
# Usage:
#   sudo bash uninstall-manager.sh
# ============================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

INSTALL_DIR="/opt/vpn-manager"
KEEP_DATA=false

print_header() {
    echo -e "${RED}"
    echo "============================================================"
    echo "  VPN Manager - Uninstallation"
    echo "============================================================"
    echo -e "${NC}"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ $1${NC}"
}

check_root() {
    if [ "$EUID" -ne 0 ]; then
        print_error "This script must be run as root"
        exit 1
    fi
}

confirm_uninstall() {
    echo ""
    print_warning "This will remove VPN Manager!"
    echo ""
    echo "Choose uninstall mode:"
    echo "1) Full remove (delete containers, volumes, images, and install directory)"
    echo "2) Keep data (delete containers and images, keep database volumes)"
    read -p "Choice [1-2]: " uninstall_choice < /dev/tty

    case $uninstall_choice in
        2)
            KEEP_DATA=true
            print_info "Keeping data volumes"
            ;;
        *)
            KEEP_DATA=false
            print_info "Full remove selected"
            ;;
    esac

    echo ""
    read -p "Are you sure you want to continue? (yes/no): " confirm < /dev/tty
    if [ "$confirm" != "yes" ]; then
        print_info "Uninstallation cancelled"
        exit 0
    fi
}

stop_services() {
    print_info "Stopping services..."
    
    if [ -f "$INSTALL_DIR/docker-compose.yml" ]; then
        cd "$INSTALL_DIR"
        # Stop all profiles so database containers are also removed
        docker compose --profile postgres --profile mysql down || true
        print_success "Services stopped"
    else
        print_warning "docker-compose.yml not found, skipping service stop"
    fi
}

check_openvpn() {
    # Check if OpenVPN is installed (all-in-one mode)
    if systemctl is-active --quiet openvpn-server@server.service 2>/dev/null || \
       systemctl is-active --quiet openvpn@server.service 2>/dev/null; then
        return 0
    fi
    return 1
}

remove_openvpn() {
    if check_openvpn; then
        echo ""
        print_warning "Detected OpenVPN installation (All-in-One mode)"
        read -p "Do you want to remove OpenVPN and VPN Node? (yes/no): " remove_vpn < /dev/tty
        
        if [ "$remove_vpn" = "yes" ]; then
            print_info "Removing OpenVPN..."
            
            # Stop OpenVPN
            systemctl stop openvpn-server@server.service 2>/dev/null || true
            systemctl stop openvpn@server.service 2>/dev/null || true
            systemctl disable openvpn-server@server.service 2>/dev/null || true
            systemctl disable openvpn@server.service 2>/dev/null || true
            
            # Stop iptables service
            systemctl stop openvpn-iptables.service 2>/dev/null || true
            systemctl disable openvpn-iptables.service 2>/dev/null || true
            rm -f /etc/systemd/system/openvpn-iptables.service
            
            systemctl daemon-reload
            
            print_success "OpenVPN removed"
            
            echo ""
            read -p "Do you want to remove OpenVPN configuration and certificates? (yes/no): " remove_config < /dev/tty
            
            if [ "$remove_config" = "yes" ]; then
                print_info "Removing OpenVPN configuration..."
                rm -rf /etc/openvpn/server
                rm -rf /etc/openvpn/easy-rsa
                rm -rf /var/log/openvpn
                print_success "OpenVPN configuration removed"
            else
                print_info "Keeping OpenVPN configuration"
            fi
        else
            print_info "Keeping OpenVPN installation"
        fi
    fi
}

remove_volumes() {
    if [ "$KEEP_DATA" = true ]; then
        delete_data="no"
    else
        delete_data="yes"
    fi

    if [ "$delete_data" = "yes" ]; then
        print_info "Removing Docker volumes..."
        
        docker volume rm vpn-manager_manager_data 2>/dev/null || true
        docker volume rm vpn-manager_postgres_data 2>/dev/null || true
        docker volume rm vpn-manager_mariadb_data 2>/dev/null || true
        
        print_success "Volumes removed"
    else
        print_info "Keeping data volumes (can be removed manually later)"
    fi
}

remove_images() {
    echo ""
    read -p "Do you want to remove Docker images? (yes/no): " remove_imgs < /dev/tty
    
    if [ "$remove_imgs" = "yes" ]; then
        print_info "Removing Docker images..."
        
        docker rmi ghcr.io/adityadarma/vpn-manager:api 2>/dev/null || true
        docker rmi ghcr.io/adityadarma/vpn-manager:web 2>/dev/null || true
        docker rmi ghcr.io/adityadarma/vpn-manager:agent 2>/dev/null || true
        
        print_success "Images removed"
    else
        print_info "Keeping Docker images"
    fi
}

backup_before_remove() {
    echo ""
    read -p "Do you want to create a backup before uninstalling? (yes/no): " create_backup < /dev/tty
    
    if [ "$create_backup" = "yes" ]; then
        if [ -f "$INSTALL_DIR/backup.sh" ]; then
            print_info "Creating backup..."
            bash "$INSTALL_DIR/backup.sh"
            print_success "Backup created in /opt/vpn-backups"
        else
            print_warning "Backup script not found"
        fi
    fi
}

remove_install_dir() {
    if [ "$KEEP_DATA" = true ]; then
        remove_dir="no"
    else
        echo ""
        read -p "Do you want to remove installation directory ($INSTALL_DIR)? (yes/no): " remove_dir < /dev/tty
    fi
    
    if [ "$remove_dir" = "yes" ]; then
        print_info "Removing installation directory..."
        rm -rf "$INSTALL_DIR"
        print_success "Installation directory removed"
    else
        print_info "Keeping installation directory"
    fi
}

remove_cron_jobs() {
    print_info "Checking for cron jobs..."

    if crontab -l 2>/dev/null | grep -q "vpn"; then
        print_warning "Found VPN-related cron jobs"
        echo ""
        crontab -l | grep "vpn"
        echo ""
        read -p "Remove these cron jobs? (yes/no): " remove_cron < /dev/tty
    else
        print_info "No cron jobs found"
        return 0
    fi
    
    if [ "$remove_cron" = "yes" ]; then
        if crontab -l 2>/dev/null | grep -q "vpn"; then
            crontab -l | grep -v "vpn" | crontab -
            print_success "Cron jobs removed"
        fi
    fi
}

print_summary() {
    echo ""
    echo -e "${GREEN}"
    echo "============================================================"
    echo "  Uninstallation Complete!"
    echo "============================================================"
    echo -e "${NC}"
    echo ""
    echo -e "${BLUE}What was removed:${NC}"
    echo "  - Docker containers stopped"
    
    if [ "$delete_data" = "yes" ]; then
        echo "  - Data volumes deleted"
    fi
    
    if [ "$remove_imgs" = "yes" ]; then
        echo "  - Docker images removed"
    fi
    
    if [ "$remove_dir" = "yes" ]; then
        echo "  - Installation directory removed"
    fi
    
    echo ""
    echo -e "${BLUE}Manual cleanup (if needed):${NC}"
    echo "  - Backups: /opt/vpn-backups"
    echo "  - Nginx config: /etc/nginx/sites-available/vpn"
    echo "  - SSL certificates: /etc/letsencrypt/live/yourdomain.com"
    echo ""
    echo -e "${BLUE}To reinstall:${NC}"
    echo "  curl -fsSL https://raw.githubusercontent.com/adityadarma/vpn-manager/main/scripts/install-manager.sh | sudo bash"
    echo ""
}

main() {
    print_header
    check_root
    confirm_uninstall
    backup_before_remove
    stop_services
    remove_openvpn
    remove_volumes
    remove_images
    remove_cron_jobs
    remove_install_dir
    print_summary
}

main
