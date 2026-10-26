module "network" {
  count  = var.enable_vpc && var.existing_vpc_id == "" ? 1 : 0
  source = "./modules/network"

  name                 = local.name
  vpc_cidr             = var.vpc_cidr
  azs                  = local.azs
  public_subnet_cidrs  = slice(var.public_subnet_cidrs, 0, local.az_count)
  private_subnet_cidrs = slice(var.private_subnet_cidrs, 0, local.az_count)
  enable_nat_gateway   = var.enable_nat_gateway
}

module "security" {
  source = "./modules/security"

  name                  = local.name
  vpc_id                = local.effective_vpc_id
  allowed_ingress_cidrs = var.allowed_ingress_cidrs
  app_port              = var.app_port
  frontend_port         = var.frontend_port
  grafana_port          = var.grafana_port
  direct_port           = var.direct_port
  ssh_port              = var.ssh_port
  enable_direct_ingress = var.enable_direct_ingress
  enable_ssh            = var.enable_ssh
  enable_alb            = var.enable_alb
  https                 = local.https
}

module "alb" {
  count  = var.enable_alb ? 1 : 0
  source = "./modules/alb"

  name                = local.name
  vpc_id              = local.effective_vpc_id
  public_subnet_ids   = local.effective_public_subnets
  security_group_id   = module.security.alb_security_group_id
  app_port            = var.app_port
  health_check_path   = var.health_check_path
  idle_timeout        = var.alb_idle_timeout
  deletion_protection = var.alb_deletion_protection
  certificate_arn     = local.effective_certificate_arn
}

# Attach existing running EC2 instance directly to the ALB target group (only when ALB is enabled)
resource "aws_lb_target_group_attachment" "existing_ec2" {
  count            = var.enable_alb && var.existing_instance_id != "" ? 1 : 0
  target_group_arn = module.alb[0].target_group_arn
  target_id        = var.existing_instance_id
  port             = var.app_port
}

# Attach the Terraform-managed security group directly to the existing running EC2 instance
data "aws_instance" "existing" {
  count       = var.existing_instance_id != "" ? 1 : 0
  instance_id = var.existing_instance_id
}

resource "aws_network_interface_sg_attachment" "existing" {
  count                = var.existing_instance_id != "" ? 1 : 0
  security_group_id    = module.security.app_security_group_id
  network_interface_id = data.aws_instance.existing[0].network_interface_id
}

# Auto Scaling Group deployment (used for greenfield or when ASG mode is explicitly enabled)
module "compute" {
  count  = var.enable_asg && var.existing_instance_id == "" ? 1 : 0
  source = "./modules/compute"

  name                = local.name
  ami_id              = data.aws_ami.amazon_linux.id
  instance_type       = var.instance_type
  root_volume_size_gb = var.root_volume_size_gb
  private_subnet_ids  = local.effective_private_subnets
  security_group_id   = module.security.app_security_group_id
  target_group_arn    = var.enable_alb ? module.alb[0].target_group_arn : ""
  desired_capacity    = var.desired_capacity
  min_capacity        = var.min_capacity
  max_capacity        = var.max_capacity
  app_source_url      = var.app_source_url
  app_version         = var.app_version
  aws_region          = var.aws_region
}

