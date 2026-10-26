output "load_balancer_dns_name" {
  description = "Public DNS name of the load balancer (when ALB is enabled)."
  value       = var.enable_alb && length(module.alb) > 0 ? module.alb[0].dns_name : null
}

output "https_enabled" {
  description = "Whether HTTPS is active (direct EC2 self-signed TLS or ALB)."
  value       = true
}

output "https_url" {
  description = "Public HTTPS URL for the SurgeGuard cluster."
  value       = "https://${var.domain_name != "" ? var.domain_name : (var.ec2_public_ip != "" ? var.ec2_public_ip : (var.enable_alb && length(module.alb) > 0 ? module.alb[0].dns_name : "localhost"))}"
}

output "certificate_arn" {
  description = "ACM Certificate ARN used by the ALB HTTPS listener (when ALB is enabled)."
  value       = local.effective_certificate_arn != "" ? local.effective_certificate_arn : null
}

output "alb_target_group_arn" {
  description = "Target group ARN forwarding to SurgeGuard protected edge port 8088 (when ALB is enabled)."
  value       = var.enable_alb && length(module.alb) > 0 ? module.alb[0].target_group_arn : null
}

output "app_security_group_id" {
  description = "Security Group ID with ports 8088, 3000, 3001, 8081, 443, 80, 22."
  value       = module.security.app_security_group_id
}

output "alb_security_group_id" {
  description = "Security Group ID for the Public Application Load Balancer."
  value       = module.security.alb_security_group_id
}

output "autoscaling_group_name" {
  description = "Auto Scaling group running the SurgeGuard host (if in ASG mode)."
  value       = length(module.compute) > 0 ? module.compute[0].autoscaling_group_name : null
}

output "attached_instance_id" {
  description = "Effective EC2 instance attached directly to the ALB target group."
  value       = var.existing_instance_id != "" ? var.existing_instance_id : null
}

output "vpc_id" {
  description = "Effective VPC ID."
  value       = local.effective_vpc_id
}
