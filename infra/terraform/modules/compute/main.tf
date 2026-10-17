variable "name" { type = string }
variable "ami_id" {
  type      = string
  sensitive = false
}
variable "instance_type" { type = string }
variable "root_volume_size_gb" { type = number }
variable "private_subnet_ids" { type = list(string) }
variable "security_group_id" { type = string }
variable "target_group_arn" { type = string }
variable "desired_capacity" { type = number }
variable "min_capacity" { type = number }
variable "max_capacity" { type = number }
variable "app_source_url" { type = string }
variable "app_version" { type = string }
variable "ssm_parameter_prefix" { type = string }
variable "ssm_parameter_arn" { type = string }
variable "aws_region" { type = string }

data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "host" {
  name_prefix        = substr("${var.name}-host-", 0, 38)
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

# Session Manager instead of SSH: no inbound port 22, no key pairs.
resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.host.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

data "aws_iam_policy_document" "read_env" {
  statement {
    sid       = "ReadRuntimeConfig"
    actions   = ["ssm:GetParametersByPath", "ssm:GetParameters", "ssm:GetParameter"]
    resources = [var.ssm_parameter_arn, "${var.ssm_parameter_arn}/*"]
  }
  statement {
    sid       = "DecryptSecureStrings"
    actions   = ["kms:Decrypt"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${var.aws_region}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "read_env" {
  name   = "read-runtime-config"
  role   = aws_iam_role.host.id
  policy = data.aws_iam_policy_document.read_env.json
}

resource "aws_iam_instance_profile" "host" {
  name_prefix = substr("${var.name}-host-", 0, 38)
  role        = aws_iam_role.host.name
}

resource "aws_launch_template" "host" {
  name_prefix   = "${var.name}-host-"
  image_id      = var.ami_id
  instance_type = var.instance_type

  iam_instance_profile { arn = aws_iam_instance_profile.host.arn }
  vpc_security_group_ids = [var.security_group_id]

  metadata_options {
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
    http_endpoint               = "enabled"
  }

  block_device_mappings {
    device_name = "/dev/xvda"
    ebs {
      volume_size           = var.root_volume_size_gb
      volume_type           = "gp3"
      encrypted             = true
      delete_on_termination = true
    }
  }

  # No secrets in user data: values are fetched from Parameter Store at boot.
  user_data = base64encode(templatefile("${path.module}/user-data.sh.tftpl", {
    app_source_url       = var.app_source_url
    app_version          = var.app_version
    ssm_parameter_prefix = var.ssm_parameter_prefix
    aws_region           = var.aws_region
  }))

  tag_specifications {
    resource_type = "instance"
    tags          = { Name = "${var.name}-host" }
  }
}

resource "aws_autoscaling_group" "host" {
  name_prefix               = "${var.name}-"
  vpc_zone_identifier       = var.private_subnet_ids
  desired_capacity          = var.desired_capacity
  min_size                  = var.min_capacity
  max_size                  = var.max_capacity
  target_group_arns         = [var.target_group_arn]
  health_check_type         = "ELB"
  health_check_grace_period = 300

  launch_template {
    id      = aws_launch_template.host.id
    version = "$Latest"
  }

  instance_refresh {
    strategy = "Rolling"
    preferences { min_healthy_percentage = 0 }
  }

  tag {
    key                 = "Name"
    value               = "${var.name}-host"
    propagate_at_launch = true
  }
}

output "autoscaling_group_name" { value = aws_autoscaling_group.host.name }
