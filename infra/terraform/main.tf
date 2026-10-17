module "network" {
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
  vpc_id                = module.network.vpc_id
  allowed_ingress_cidrs = var.allowed_ingress_cidrs
  app_port              = var.app_port
  https                 = local.https
}

module "alb" {
  source = "./modules/alb"

  name                = local.name
  vpc_id              = module.network.vpc_id
  public_subnet_ids   = module.network.public_subnet_ids
  security_group_id   = module.security.alb_security_group_id
  app_port            = var.app_port
  health_check_path   = var.health_check_path
  idle_timeout        = var.alb_idle_timeout
  deletion_protection = var.alb_deletion_protection
  certificate_arn     = var.certificate_arn
}

module "compute" {
  source = "./modules/compute"

  name                 = local.name
  ami_id               = data.aws_ssm_parameter.ami.value
  instance_type        = var.instance_type
  root_volume_size_gb  = var.root_volume_size_gb
  private_subnet_ids   = module.network.private_subnet_ids
  security_group_id    = module.security.app_security_group_id
  target_group_arn     = module.alb.target_group_arn
  desired_capacity     = var.desired_capacity
  min_capacity         = var.min_capacity
  max_capacity         = var.max_capacity
  app_source_url       = var.app_source_url
  app_version          = var.app_version
  ssm_parameter_prefix = local.ssm_prefix
  ssm_parameter_arn    = "arn:${data.aws_partition.current.partition}:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${local.ssm_prefix}"
  aws_region           = var.aws_region
}
