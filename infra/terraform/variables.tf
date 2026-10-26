variable "aws_region" {
  description = "AWS region to deploy into, e.g. ap-south-1."
  type        = string
  default     = "ap-south-1"
  validation {
    condition     = can(regex("^[a-z]{2}(-gov)?-[a-z]+-[0-9]$", var.aws_region))
    error_message = "aws_region must look like ap-south-1."
  }
}

variable "project_name" {
  description = "Project name used in resource names and tags."
  type        = string
  default     = "surgeguard"
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,20}$", var.project_name))
    error_message = "project_name must be 2-21 chars of lowercase letters, digits and dashes."
  }
}

variable "environment" {
  description = "Deployment environment."
  type        = string
  default     = "dev"
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be dev, staging or prod."
  }
}

variable "name_prefix" {
  description = "Optional explicit prefix for resource names. Defaults to <project_name>-<environment>."
  type        = string
  default     = ""
  validation {
    condition     = var.name_prefix == "" || can(regex("^[a-z][a-z0-9-]{1,28}$", var.name_prefix))
    error_message = "name_prefix must be lowercase letters, digits and dashes (max 29 chars)."
  }
}

variable "ec2_public_ip" {
  description = "Public IP of an existing EC2 instance (e.g. 3.109.184.177). Used by Terraform to automatically discover the running instance, VPC, and subnets dynamically from .env."
  type        = string
  default     = ""
}

variable "existing_instance_id" {
  description = "Optional ID of an already configured and running EC2 instance to attach to ALB and security groups (e.g. i-0123456789abcdef0)."
  type        = string
  default     = ""
}

variable "existing_vpc_id" {
  description = "Optional existing VPC ID to deploy into (e.g. AWS default VPC vpc-xxxx). When set, VPC creation is bypassed."
  type        = string
  default     = ""
}

variable "existing_subnet_ids" {
  description = "List of existing public subnet IDs (at least 2 in different AZs for the ALB)."
  type        = list(string)
  default     = []
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC (used when existing_vpc_id is empty)."
  type        = string
  default     = "172.31.0.0/16"
  validation {
    condition     = can(cidrnetmask(var.vpc_cidr))
    error_message = "vpc_cidr must be a valid IPv4 CIDR."
  }
}

variable "public_subnet_cidrs" {
  description = "CIDRs for public subnets (load balancer), one per availability zone."
  type        = list(string)
  default     = ["172.31.0.0/20", "172.31.16.0/20"]
  validation {
    condition     = length(var.public_subnet_cidrs) >= 2 && alltrue([for c in var.public_subnet_cidrs : can(cidrnetmask(c))])
    error_message = "Provide at least two valid public subnet CIDRs (an ALB needs two AZs)."
  }
}

variable "private_subnet_cidrs" {
  description = "CIDRs for private subnets (application instances), one per availability zone."
  type        = list(string)
  default     = ["172.31.32.0/20", "172.31.48.0/20"]
  validation {
    condition     = length(var.private_subnet_cidrs) >= 2 && alltrue([for c in var.private_subnet_cidrs : can(cidrnetmask(c))])
    error_message = "Provide at least two valid private subnet CIDRs."
  }
}

variable "enable_nat_gateway" {
  description = "Create a single NAT gateway so private instances can pull images and packages (costs money)."
  type        = bool
  default     = false
}

variable "allowed_ingress_cidrs" {
  description = "CIDRs allowed to reach the load balancer and SurgeGuard direct ports."
  type        = list(string)
  default     = ["0.0.0.0/0"]
  validation {
    condition     = length(var.allowed_ingress_cidrs) > 0 && alltrue([for c in var.allowed_ingress_cidrs : can(cidrnetmask(c))])
    error_message = "allowed_ingress_cidrs must contain valid CIDRs."
  }
}

variable "app_port" {
  description = "Port of the SurgeGuard protected entry point (Nginx) on the host."
  type        = number
  default     = 8088
  validation {
    condition     = var.app_port > 1024 && var.app_port < 65536
    error_message = "app_port must be an unprivileged port."
  }
}

variable "frontend_port" {
  description = "Port of the SurgeGuard admin web console on the host."
  type        = number
  default     = 3000
}

variable "grafana_port" {
  description = "Port of Grafana on the host."
  type        = number
  default     = 3001
}

variable "direct_port" {
  description = "Port of the unprotected direct demo backend on the host."
  type        = number
  default     = 8081
}

variable "ssh_port" {
  description = "SSH port on the host."
  type        = number
  default     = 22
}

variable "enable_direct_ingress" {
  description = "Allow direct ingress to SurgeGuard ports (8088, 3000, 3001, 8081) on the EC2 security group."
  type        = bool
  default     = true
}

variable "enable_ssh" {
  description = "Allow inbound SSH (port 22) on the EC2 security group."
  type        = bool
  default     = true
}

variable "instance_type" {
  description = "EC2 instance type for the application host."
  type        = string
  default     = "t3.medium"
  validation {
    condition     = can(regex("^[a-z0-9]+\\.[a-z0-9]+$", var.instance_type))
    error_message = "instance_type must look like t3.medium."
  }
}

variable "ami_ssm_parameter" {
  description = "Public SSM parameter that resolves to the AMI id (looked up at plan time, never hardcoded)."
  type        = string
  default     = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

variable "root_volume_size_gb" {
  description = "Root EBS volume size."
  type        = number
  default     = 30
  validation {
    condition     = var.root_volume_size_gb >= 20 && var.root_volume_size_gb <= 500
    error_message = "root_volume_size_gb must be between 20 and 500."
  }
}

variable "desired_capacity" {
  description = "Desired number of application hosts."
  type        = number
  default     = 1
}

variable "min_capacity" {
  description = "Minimum number of application hosts."
  type        = number
  default     = 1
}

variable "max_capacity" {
  description = "Maximum number of application hosts. More than 1 requires use_shared_redis (queue state must be shared)."
  type        = number
  default     = 1
  validation {
    condition     = var.max_capacity >= 1 && var.max_capacity <= 10
    error_message = "max_capacity must be between 1 and 10."
  }
}

variable "use_shared_redis" {
  description = "Set true when REDIS_URL in Parameter Store points to a shared Redis (e.g. ElastiCache, not created here). Required for more than one host."
  type        = bool
  default     = false
}

variable "health_check_path" {
  description = "Load balancer health check path served by Nginx without authentication."
  type        = string
  default     = "/waiting-room"
}

variable "alb_idle_timeout" {
  description = "ALB idle timeout in seconds."
  type        = number
  default     = 60
  validation {
    condition     = var.alb_idle_timeout >= 1 && var.alb_idle_timeout <= 4000
    error_message = "alb_idle_timeout must be between 1 and 4000."
  }
}

variable "alb_deletion_protection" {
  description = "Protect the load balancer from accidental deletion."
  type        = bool
  default     = false
}

variable "domain_name" {
  description = "Optional DNS name served by the load balancer (DNS records are not managed here)."
  type        = string
  default     = ""
}

variable "certificate_arn" {
  description = "Optional ACM certificate ARN. When set, HTTPS is served and HTTP redirects to HTTPS."
  type        = string
  default     = ""
  validation {
    condition     = var.certificate_arn == "" || can(regex("^arn:aws[a-z-]*:acm:", var.certificate_arn))
    error_message = "certificate_arn must be an ACM certificate ARN."
  }
}

variable "app_source_url" {
  description = "HTTPS git URL the instance clones the SurgeGuard repository from."
  type        = string
  default     = "https://github.com/Ask99Ayush/SurgeGuard.git"
  validation {
    condition     = can(regex("^https://", var.app_source_url))
    error_message = "app_source_url must be an https:// URL."
  }
}

variable "app_version" {
  description = "Git tag or commit to deploy."
  type        = string
  default     = "main"
}

variable "ssm_parameter_prefix" {
  description = "SSM Parameter Store path holding the runtime .env values (one SecureString per key). Defaults to /<name>/env."
  type        = string
  default     = ""
}

variable "tags" {
  description = "Extra tags applied to every resource."
  type        = map(string)
  default     = {}
}
