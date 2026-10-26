variable "name" { type = string }
variable "vpc_id" { type = string }
variable "allowed_ingress_cidrs" { type = list(string) }
variable "app_port" { type = number }
variable "frontend_port" {
  type    = number
  default = 3000
}
variable "grafana_port" {
  type    = number
  default = 3001
}
variable "direct_port" {
  type    = number
  default = 8081
}
variable "ssh_port" {
  type    = number
  default = 22
}
variable "enable_direct_ingress" {
  type    = bool
  default = true
}
variable "enable_ssh" {
  type    = bool
  default = true
}
variable "https" { type = bool }

resource "aws_security_group" "alb" {
  name_prefix = "${var.name}-alb-"
  description = "Public load balancer for SurgeGuard"
  vpc_id      = var.vpc_id
  lifecycle { create_before_destroy = true }
  tags = { Name = "${var.name}-alb" }
}

resource "aws_vpc_security_group_ingress_rule" "alb_http" {
  for_each          = toset(var.allowed_ingress_cidrs)
  security_group_id = aws_security_group.alb.id
  description       = "HTTP (redirects to HTTPS when a certificate is configured)"
  cidr_ipv4         = each.value
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
}

resource "aws_vpc_security_group_ingress_rule" "alb_https" {
  for_each          = var.https ? toset(var.allowed_ingress_cidrs) : toset([])
  security_group_id = aws_security_group.alb.id
  description       = "HTTPS"
  cidr_ipv4         = each.value
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_egress_rule" "alb_to_app" {
  security_group_id            = aws_security_group.alb.id
  description                  = "Forward to the SurgeGuard edge only"
  referenced_security_group_id = aws_security_group.app.id
  ip_protocol                  = "tcp"
  from_port                    = var.app_port
  to_port                      = var.app_port
}

resource "aws_security_group" "app" {
  name_prefix = "${var.name}-app-"
  description = "SurgeGuard host: ALB ingress and direct admin ports"
  vpc_id      = var.vpc_id
  lifecycle { create_before_destroy = true }
  tags = { Name = "${var.name}-app" }
}

resource "aws_vpc_security_group_ingress_rule" "app_from_alb" {
  security_group_id            = aws_security_group.app.id
  description                  = "Protected entry point from the ALB"
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = var.app_port
  to_port                      = var.app_port
}

resource "aws_vpc_security_group_ingress_rule" "app_protected_direct" {
  for_each          = var.enable_direct_ingress ? toset(var.allowed_ingress_cidrs) : toset([])
  security_group_id = aws_security_group.app.id
  description       = "SurgeGuard Protected Gateway (Nginx :8088)"
  cidr_ipv4         = each.value
  ip_protocol       = "tcp"
  from_port         = var.app_port
  to_port           = var.app_port
}

resource "aws_vpc_security_group_ingress_rule" "app_frontend" {
  for_each          = var.enable_direct_ingress ? toset(var.allowed_ingress_cidrs) : toset([])
  security_group_id = aws_security_group.app.id
  description       = "SurgeGuard Web App Console (:3000)"
  cidr_ipv4         = each.value
  ip_protocol       = "tcp"
  from_port         = var.frontend_port
  to_port           = var.frontend_port
}

resource "aws_vpc_security_group_ingress_rule" "app_grafana" {
  for_each          = var.enable_direct_ingress ? toset(var.allowed_ingress_cidrs) : toset([])
  security_group_id = aws_security_group.app.id
  description       = "Grafana SRE Observability Dashboards (:3001)"
  cidr_ipv4         = each.value
  ip_protocol       = "tcp"
  from_port         = var.grafana_port
  to_port           = var.grafana_port
}

resource "aws_vpc_security_group_ingress_rule" "app_direct_backend" {
  for_each          = var.enable_direct_ingress ? toset(var.allowed_ingress_cidrs) : toset([])
  security_group_id = aws_security_group.app.id
  description       = "Direct demo backend (:8081)"
  cidr_ipv4         = each.value
  ip_protocol       = "tcp"
  from_port         = var.direct_port
  to_port           = var.direct_port
}

resource "aws_vpc_security_group_ingress_rule" "app_https" {
  for_each          = var.enable_direct_ingress ? toset(var.allowed_ingress_cidrs) : toset([])
  security_group_id = aws_security_group.app.id
  description       = "Direct HTTPS (:443)"
  cidr_ipv4         = each.value
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_ingress_rule" "app_http_direct" {
  for_each          = var.enable_direct_ingress ? toset(var.allowed_ingress_cidrs) : toset([])
  security_group_id = aws_security_group.app.id
  description       = "Direct HTTP (:80)"
  cidr_ipv4         = each.value
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
}

resource "aws_vpc_security_group_ingress_rule" "app_ssh" {
  for_each          = var.enable_ssh ? toset(var.allowed_ingress_cidrs) : toset([])
  security_group_id = aws_security_group.app.id
  description       = "SSH management (:22)"
  cidr_ipv4         = each.value
  ip_protocol       = "tcp"
  from_port         = var.ssh_port
  to_port           = var.ssh_port
}

resource "aws_vpc_security_group_egress_rule" "app_https" {
  security_group_id = aws_security_group.app.id
  description       = "Package, image and AWS API access (via NAT)"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_egress_rule" "app_http" {
  security_group_id = aws_security_group.app.id
  description       = "Package mirrors that still use HTTP"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
}

output "alb_security_group_id" { value = aws_security_group.alb.id }
output "app_security_group_id" { value = aws_security_group.app.id }
