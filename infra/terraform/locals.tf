data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_ssm_parameter" "ami" {
  name = var.ami_ssm_parameter
}

data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

locals {
  name       = var.name_prefix != "" ? var.name_prefix : "${var.project_name}-${var.environment}"
  ssm_prefix = var.ssm_parameter_prefix != "" ? var.ssm_parameter_prefix : "/${local.name}/env"
  az_count   = min(length(var.public_subnet_cidrs), length(var.private_subnet_cidrs))
  azs        = slice(data.aws_availability_zones.available.names, 0, local.az_count)
  https      = var.certificate_arn != ""

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
