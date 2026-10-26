data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_ssm_parameter" "ami" {
  name = var.ami_ssm_parameter
}

data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

data "aws_subnets" "existing" {
  count = var.existing_vpc_id != "" && length(var.existing_subnet_ids) == 0 ? 1 : 0
  filter {
    name   = "vpc-id"
    values = [var.existing_vpc_id]
  }
}

locals {
  name       = var.name_prefix != "" ? var.name_prefix : "${var.project_name}-${var.environment}"
  ssm_prefix = var.ssm_parameter_prefix != "" ? var.ssm_parameter_prefix : "/${local.name}/env"
  az_count   = min(length(var.public_subnet_cidrs), length(var.private_subnet_cidrs))
  azs        = slice(data.aws_availability_zones.available.names, 0, local.az_count)

  effective_vpc_id = var.existing_vpc_id != "" ? var.existing_vpc_id : (length(module.network) > 0 ? module.network[0].vpc_id : "")

  effective_public_subnets = length(var.existing_subnet_ids) >= 2 ? var.existing_subnet_ids : (
    var.existing_vpc_id != "" && length(data.aws_subnets.existing) > 0 ? slice(data.aws_subnets.existing[0].ids, 0, min(3, length(data.aws_subnets.existing[0].ids))) : (
      length(module.network) > 0 ? module.network[0].public_subnet_ids : []
    )
  )

  effective_private_subnets = length(var.existing_subnet_ids) >= 2 ? var.existing_subnet_ids : (
    length(module.network) > 0 ? module.network[0].private_subnet_ids : []
  )

  effective_certificate_arn = var.certificate_arn

  https = local.effective_certificate_arn != ""

  common_tags = merge(var.tags, {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
  })
}

check "single_host_without_shared_redis" {
  assert {
    condition     = var.max_capacity == 1 || var.use_shared_redis
    error_message = "max_capacity > 1 needs use_shared_redis = true: each host would otherwise run its own queue."
  }
}

check "capacity_bounds" {
  assert {
    condition     = var.min_capacity <= var.desired_capacity && var.desired_capacity <= var.max_capacity
    error_message = "Capacities must satisfy min <= desired <= max."
  }
}
