terraform {
  required_version = ">= 1.6.0, < 2.0.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.80"
    }
  }
}

provider "aws" {
  region = var.aws_region

  # Credentials come from the standard AWS chain (SSO / assumed role / instance profile).
  # Nothing in this repository configures or stores credentials.
  default_tags {
    tags = local.common_tags
  }
}
